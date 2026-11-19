import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "glisse";
import "glisse/styles.css";
import "./styles.css";

const suggestions = [
  {
    label: "Debug some code",
    prompt: "Help me debug this code: ",
    icon: "code",
  },
  {
    label: "Explain something",
    prompt: "Explain this simply: ",
    icon: "document",
  },
  {
    label: "Plan my day",
    prompt: "Help me plan my day: ",
    icon: "calendar",
  },
  {
    label: "Draft a message",
    prompt: "Write a message to ",
    icon: "message",
  },
  {
    label: "Morning briefing",
    prompt: "Briefing",
    icon: "bell",
  },
];

function SuggestionIcon({ name }) {
  const sharedProps = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "code":
      return (
        <svg {...sharedProps}>
          <path d="m5.5 4-3 4 3 4m5-8 3 4-3 4M9 3l-2 10" />
        </svg>
      );
    case "document":
      return (
        <svg {...sharedProps}>
          <path d="M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...sharedProps}>
          <rect x="2" y="3.5" width="12" height="10" rx="1.5" />
          <path d="M5 2v3m6-3v3M2 6.5h12" />
        </svg>
      );
    case "message":
      return (
        <svg {...sharedProps}>
          <path d="M2 3h12v8H7l-4 3v-3H2zM5 6h6M5 8.5h4" />
        </svg>
      );
    case "bell":
      return (
        <svg {...sharedProps}>
          <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4z" />
          <path d="M6.5 13a1.6 1.6 0 0 0 3 0" />
        </svg>
      );
    default:
      return null;
  }
}

function WelcomeSuggestions() {
  useEffect(() => {
    const fallback = document.querySelector("[data-react-fallback]");
    if (fallback) fallback.classList.add("react-mounted");
    return () => {
      if (fallback) fallback.classList.remove("react-mounted");
    };
  }, []);

  function selectPrompt(prompt) {
    const input = document.getElementById("userInput");
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("Nico's chat input is unavailable.");
    }
    input.value = prompt;
    input.focus();
  }

  return suggestions.map((suggestion) => (
    <Button
      key={suggestion.label}
      type="button"
      className="nico-react-suggestion"
      icon={<SuggestionIcon name={suggestion.icon} />}
      onClick={() => selectPrompt(suggestion.prompt)}
    >
      {suggestion.label}
    </Button>
  ));
}

const mountNode = document.getElementById("reactWelcomeSuggestions");
if (mountNode) {
  createRoot(mountNode).render(<WelcomeSuggestions />);
}
