# %% [markdown]
# # Gemini API Quota Tester
# This notebook tests your Gemini API key directly against the Google Generative AI endpoints to diagnose quota/429 issues.

# %%
# Install dependencies if needed
# !pip install requests python-dotenv

# %%
import os
import requests
import json
from dotenv import load_dotenv

# 1. Load the API key from your .env file
# This assumes the .env file is in the same directory as this notebook
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: GEMINI_API_KEY not found in .env file.")
else:
    print(f"✅ Found API Key: {api_key[:8]}...{api_key[-4:]}")

# %%
# 2. Define the test function
def test_gemini_model(model_name="gemini-1.5-flash-8b", api_version="v1beta"):
    url = f"https://generativelanguage.googleapis.com/{api_version}/models/{model_name}:generateContent?key={api_key}"
    
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "contents": [{
            "parts": [{
                "text": "Say 'Connection Successful' if you can read this."
            }]
        }]
    }
    
    print(f"\n--- Testing Model: {model_name} ({api_version}) ---")
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            result = response.json()
            text = result['candidates'][0]['content']['parts'][0]['text']
            print(f"🟢 SUCCESS! Response: {text.strip()}")
        else:
            print(f"🔴 FAILED (Status {response.status_code})")
            print(f"Error Detail: {response.text}")
            
    except Exception as e:
        print(f"💥 Exception: {str(e)}")

# %%
# 3. Run the tests
# We test a few variants to see which one (if any) works for your key
if api_key:
    # Test 1: The standard v1beta 1.5-flash
    test_gemini_model("gemini-1.5-flash", "v1beta")
    
    # Test 2: The 8B version (often has more free quota)
    test_gemini_model("gemini-1.5-flash-8b", "v1beta")
    
    # Test 3: The v1 (Production) endpoint
    test_gemini_model("gemini-1.5-flash", "v1")
    
    # Test 4: 2.0 Flash Lite (the one we just tried)
    test_gemini_model("gemini-2.0-flash-lite", "v1beta")
