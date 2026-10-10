import os
from dotenv import load_dotenv

load_dotenv()
from google import genai
from google.genai import types

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

for model in ["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"]:
    try:
        resp = client.models.generate_content(
            model=model,
            contents="a red dog",
            config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
        )
        nbytes = sum(
            len(p.inline_data.data)
            for p in (resp.parts or [])
            if getattr(p, "inline_data", None) and getattr(p.inline_data, "data", None)
        )
        print(("PASS" if nbytes > 0 else "FAIL-NOBYTES"), model, "bytes=", nbytes)
    except Exception as e:
        s = str(e).replace("\n", " ")
        tag = "quota0" if "limit: 0" in s else ("throttled" if "429" in s else "other")
        print("FAIL", model, tag, s[:140])
