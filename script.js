(function () {
  var $ = function (i) {
    return document.getElementById(i);
  };
  /* fireworks */
  var c = $("fx"),
    x = c.getContext("2d"),
    ps = [],
    run = false,
    cols = ["#a58cff", "#c9b8ff", "#ff7d4a", "#ffd2b8", "#ffffff"];
  function size() {
    var d = devicePixelRatio || 1;
    c.width = innerWidth * d;
    c.height = innerHeight * d;
    x.setTransform(d, 0, 0, d, 0, 0);
  }
  size();
  addEventListener("resize", size);
  function burst(px, py, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283,
        s = 1.5 + Math.random() * 4.5;
      ps.push({
        x: px,
        y: py,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        l: 1,
        c: cols[(Math.random() * 5) | 0],
      });
    }
    if (!run) {
      run = true;
      requestAnimationFrame(tick);
    }
  }
  function tick() {
    x.clearRect(0, 0, innerWidth, innerHeight);
    ps = ps.filter(function (p) {
      return p.l > 0;
    });
    ps.forEach(function (p) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.vx *= 0.985;
      p.l -= 0.014;
      x.globalAlpha = Math.max(p.l, 0);
      x.fillStyle = p.c;
      x.beginPath();
      x.arc(p.x, p.y, 2, 0, 6.3);
      x.fill();
    });
    if (ps.length) requestAnimationFrame(tick);
    else {
      run = false;
      x.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
  addEventListener("pointerdown", function (e) {
    if (e.target.closest("button,a")) return;
    burst(e.clientX, e.clientY, 26);
    playMusic();
  });
  /* music */
  var au = $("au"),
    sb = $("snd");
  var st = $("sndtxt");
  function playMusic() {
    return au
      .play()
      .then(function () {
        st.textContent = "Tensionado Soapdish";
        sb.classList.add("playing");
        sb.setAttribute("aria-pressed", "true");
      })
      .catch(function () {
        st.textContent = "Play music";
      });
  }
  function startMusicWithKeyboard(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    playMusic();
    document.removeEventListener("keydown", startMusicWithKeyboard);
  }
  document.addEventListener("keydown", startMusicWithKeyboard);
  sb.addEventListener("click", function () {
    if (au.paused) {
      playMusic();
    } else {
      au.pause();
      st.textContent = "Play music";
      sb.classList.remove("playing");
      sb.setAttribute("aria-pressed", "false");
    }
  });
  /* orb follows the pointer a little */
  var hero = $("home");
  if (
    matchMedia("(pointer:fine)").matches &&
    !matchMedia("(prefers-reduced-motion:reduce)").matches
  )
    hero.addEventListener("pointermove", function (e) {
      hero.style.setProperty(
        "--ox",
        (e.clientX / innerWidth - 0.5) * 50 + "px",
      );
      hero.style.setProperty(
        "--oy",
        (e.clientY / innerHeight - 0.5) * 30 + "px",
      );
    });
  /* background video: respect reduced motion */
  var sp = $("sparks");
  for (var k = 0; k < 16; k++) {
    var s = document.createElement("i");
    s.style.left = Math.random() * 100 + "%";
    s.style.animationDuration = 7 + Math.random() * 7 + "s";
    s.style.animationDelay = -Math.random() * 10 + "s";
    s.style.setProperty("--dx", (Math.random() - 0.5) * 6 + "rem");
    sp.appendChild(s);
  }
  var vd = document.querySelector(".vid");
  if (vd) {var cn = navigator.connection || {};if (cn.saveData || matchMedia("(max-width:52rem)").matches) {vd.remove();vd = null;} else if (vd.dataset.src) {vd.src = vd.dataset.src;}}
  if (vd) {
    var mark = function () {
      $("home").classList.add("has-video");
    };
    if (vd.readyState >= 2) mark();
    else vd.addEventListener("loadeddata", mark);
  }
  if (vd && matchMedia("(prefers-reduced-motion:reduce)").matches) vd.pause();
  var pull = $("pull");
  pull.addEventListener("click", function (e) {
    e.stopPropagation();
    pull.classList.add("pulled");
    var hero = $("home");
    hero.classList.add("boom");
    setTimeout(function () {
      hero.classList.remove("boom");
    }, 800);
    for (var i = 0; i < 5; i++)
      (function (i) {
        setTimeout(function () {
          burst(
            innerWidth * (0.15 + Math.random() * 0.7),
            innerHeight * (0.12 + Math.random() * 0.4),
            60,
          );
        }, i * 260);
      })(i);
    setTimeout(function () {
      pull.classList.remove("pulled");
    }, 2400);
  });
  /* cursor ring (mouse only) */
  var cur = $("cur");
  if (matchMedia("(pointer:fine)").matches)
    addEventListener("pointermove", function (e) {
      cur.style.opacity = 1;
      cur.style.transform =
        "translate(" + (e.clientX - 13) + "px," + (e.clientY - 13) + "px)";
    });
  /* header + back to top */
  var hd = $("hd"),
    top = $("top");
  addEventListener(
    "scroll",
    function () {
      hd.classList.toggle("solid", scrollY > 40);
      top.classList.toggle("show", scrollY > innerHeight * 0.6);
    },
    { passive: true },
  );
  top.addEventListener("click", function () {
    scrollTo({ top: 0 });
  });
  /* scroll spy */
  var links = document.querySelectorAll("nav a"),
    ids = ["home", "expertise", "work", "about", "contact"];
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            var k = ids.indexOf(e.target.id);
            links.forEach(function (a, i) {
              a.classList.toggle("on", i === k);
            });
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    ids.forEach(function (i) {
      io.observe($(i));
    });
  }
  /* work filter */
  var btns = document.querySelectorAll("#filters button"),
    cards = document.querySelectorAll("#grid .card"),
    msg = null;
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      btns.forEach(function (o) {
        o.classList.toggle("on", o === b);
        o.setAttribute("aria-pressed", o === b ? "true" : "false");
      });
      var f = b.dataset.f,
        n = 0;
      cards.forEach(function (cd) {
        var show =
          f === "all" || (" " + cd.dataset.c + " ").indexOf(" " + f + " ") > -1;
        cd.style.display = show ? "" : "none";
        if (show) n++;
      });
      $("ghost").style.display = f === "all" ? "" : "none";
      if (msg) {
        msg.remove();
        msg = null;
      }
      if (!n) {
        msg = document.createElement("p");
        msg.className = "none";
        msg.textContent = "Nothing in this category yet.";
        $("grid").appendChild(msg);
      }
    });
  });
  /* ---- upgrade ---- */
  var mb=$("menu");
  function closeMenu(){hd.classList.remove("open");mb.setAttribute("aria-expanded","false");mb.textContent="Menu"}
  mb.addEventListener("click",function(){var o=hd.classList.toggle("open");mb.setAttribute("aria-expanded",o);mb.textContent=o?"Close":"Menu"});
  links.forEach(function(a){a.addEventListener("click",closeMenu)});
  addEventListener("keydown",function(e){if(e.key==="Escape")closeMenu()});
  var th=$("theme"),root=document.documentElement;
  function themeNow(){return root.dataset.theme||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light")}
  try{var sv=localStorage.getItem("theme");if(sv)root.dataset.theme=sv}catch(e){}
  function lab(){th.textContent=themeNow()==="dark"?"light":"dark"}lab();
  th.addEventListener("click",function(){var n=themeNow()==="dark"?"light":"dark";root.dataset.theme=n;try{localStorage.setItem("theme",n)}catch(e){}lab()});
  var pg=$("prog");
  addEventListener("scroll",function(){var m=document.documentElement.scrollHeight-innerHeight;pg.style.transform="scaleX("+(m>0?scrollY/m:0)+")"},{passive:true});
  var tk=$("track");tk.innerHTML+=tk.innerHTML;
  var ck=$("clk");function tm(){ck.textContent=new Date().toLocaleTimeString("en-GB",{timeZone:"Asia/Manila",hour:"2-digit",minute:"2-digit"})+" PHT"}tm();setInterval(tm,30000);
  var rn=$("rain");for(var r=0;r<26;r++){var d=document.createElement("i");d.style.left=Math.random()*110+"%";d.style.animationDuration=1.1+Math.random()*1.2+"s";d.style.animationDelay=-Math.random()*2+"s";d.style.opacity=.25+Math.random()*.5;rn.appendChild(d)}
  document.addEventListener("pointerover",function(e){cur.classList.toggle("big",!!e.target.closest("a,button"))});
  document.addEventListener("pointermove",function(e){var t=e.target.closest(".cell,.card,.tiles div");if(t){var q=t.getBoundingClientRect();t.style.setProperty("--mx",e.clientX-q.left+"px");t.style.setProperty("--my",e.clientY-q.top+"px")}});
  btns.forEach(function(b){var f=b.dataset.f,n=0;cards.forEach(function(cd){if(f==="all"||(" "+cd.dataset.c+" ").indexOf(" "+f+" ")>-1)n++});b.querySelector("sup").textContent=("0"+n).slice(-2)});
  if("IntersectionObserver" in window&&!matchMedia("(prefers-reduced-motion:reduce)").matches){
    var rv=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var t=e.target;t.classList.add("in");rv.unobserve(t);setTimeout(function(){t.classList.remove("rv","in")},1000)}})},{threshold:.12});
    document.querySelectorAll(".h,.cell,.chips,.work-top>div,.filters,.card,.ghost,.about p,.tiles div,.links li,.code").forEach(function(el){var i=Array.prototype.indexOf.call(el.parentNode.children,el);el.style.setProperty("--d",Math.min(i,4)*80+"ms");el.classList.add("rv");rv.observe(el)});
  }
  /* contact form: replace "you@domain.com" with your real email below */
  var TO="you@domain.com";
  var fm=$("mail");if(fm){var ok=fm.querySelector(".ok");fm.addEventListener("submit",function(e){e.preventDefault();var fd=new FormData(fm);var sub="Hello mvtt — "+(fd.get("name")||"");var body="Name: "+fd.get("name")+"%0aEmail: "+fd.get("email")+"%0a%0a"+fd.get("message");location.href="mailto:"+TO+"?subject="+encodeURIComponent(sub)+"&body="+body;ok.textContent="Opened your mail app — hit send to deliver.";fm.reset();setTimeout(function(){ok.textContent=""},6000)})}
})();
