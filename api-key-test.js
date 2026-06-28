// API Key Diagnostic Test for Fiverr Assistant
// Run this in browser console to test your new API key

async function diagnoseApiKey() {
  console.log("=== Gemini API Key Diagnostic ===\n");
  
  // Get current settings from extension
  let settings;
  try {
    // Try to get settings from browser storage
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      const stored = await browser.storage.local.get(['geminiApiKey', 'geminiModel', 'openaiApiKey', 'openaiModel']);
      settings = {
        geminiApiKey: stored.geminiApiKey || '',
        geminiModel: stored.geminiModel || 'gemini-2.5-flash',
        openaiApiKey: stored.openaiApiKey || '',
        openaiModel: stored.openaiModel || 'gpt-4o-mini'
      };
    } else {
      // Fallback for testing - user needs to enter key manually
      const apiType = prompt("Test which API? (gemini/openai):");
      if (apiType === 'openai') {
        settings = {
          openaiApiKey: prompt("Enter your OpenAI API key to test:"),
          openaiModel: 'gpt-4o-mini',
          geminiApiKey: '',
          geminiModel: 'gemini-2.5-flash'
        };
      } else {
        settings = {
          geminiApiKey: prompt("Enter your Gemini API key to test:"),
          geminiModel: 'gemini-2.5-flash',
          openaiApiKey: '',
          openaiModel: 'gpt-4o-mini'
        };
      }
    }
    
    if (!settings.geminiApiKey && !settings.openaiApiKey) {
      console.error("No API key found. Please set your API key in extension settings first.");
      return;
    }
    
  } catch (error) {
    console.error("Error accessing settings:", error);
    return;
  }

  // Determine which API to test
  const hasOpenAI = settings.openaiApiKey && settings.openaiApiKey.length > 0;
  const hasGemini = settings.geminiApiKey && settings.geminiApiKey.length > 0;

  if (hasOpenAI) {
    console.log("Found OpenAI API key. Testing OpenAI API...\n");
    await testOpenAIKey(settings);
  } else if (hasGemini) {
    console.log("Found Gemini API key. Testing Gemini API...\n");
    await testGeminiKey(settings);
  } else {
    console.error("No API key configured.");
  }
  
  console.log("\n=== Diagnostic Complete ===");
  console.log("If issues persist:");
  console.log("1. Verify API key at extension settings");
  console.log("2. Check if key is enabled for the API");
  console.log("3. Ensure you haven't exceeded quota limits");
  console.log("4. If getting 'location not supported' error:");
  console.log("   ➜ YOUR LOCATION IS BLOCKED - Use a VPN!");
  console.log("   ➜ Download ProtonVPN (free) or NordVPN");
  console.log("   ➜ Connect to US/UK/Canada server");
  console.log("   ➜ Reload page and test again");
  console.log("5. Read detailed guide: See LOCATION_RESTRICTION_FIX.md");
  console.log("6. Try a different model");
}

async function testGeminiKey(settings) {
  console.log("1. Testing Gemini API Key Format...");
  console.log("   Key length:", settings.geminiApiKey.length);
  console.log(
    "   Key format:",
    settings.geminiApiKey.startsWith("AIza")
      ? "Valid format (starts with AIza)"
      : settings.geminiApiKey.startsWith("AQ.")
      ? "Valid format (starts with AQ.)"
      : "Invalid format",
  );
  console.log("   Model:", settings.geminiModel);
  
  // Test basic API connectivity
  console.log("\n2. Testing Gemini API Connectivity...");
  
  const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiApiKey}`;
  const testBody = {
    contents: [{
      role: "user",
      parts: [{ text: "Hello, please respond with 'API test successful'" }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 50
    }
  };
  
  try {
    console.log("   Sending test request...");
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testBody)
    });
    
    console.log("   Response status:", response.status);
    console.log("   Response headers:", Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log("   Response body:", responseText);
    
    if (response.ok) {
      const data = JSON.parse(responseText);
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const generatedText = data.candidates[0].content.parts[0].text;
        console.log("   Generated text:", generatedText);
        console.log("\n   Status: Gemini API key is working correctly! ");
      } else {
        console.log("   Status: API responded but no content generated");
      }
    } else {
      console.log("   Status: API call failed");
      
      // Specific error analysis
      if (response.status === 400) {
        if (responseText.includes("api.key.invalid")) {
          console.log("   Issue: Invalid API key format or key doesn't exist");
        } else if (responseText.includes("permission")) {
          console.log("   Issue: API key doesn't have permission for this model");
        } else if (responseText.includes("location") || responseText.includes("geographic") || responseText.includes("region")) {
          console.log("   Issue: GEOGRAPHIC/LOCATION RESTRICTION - Your country/region is not supported for Gemini API");
          console.log("   Solution: Use a VPN to connect from a supported country (US, UK, Canada, Australia, etc.)");
          console.log("   More info: https://cloud.google.com/generative-ai/docs/availability");
        }
      } else if (response.status === 403) {
        if (responseText.includes("location") || responseText.includes("geographic") || responseText.includes("region")) {
          console.log("   Issue: GEOGRAPHIC/LOCATION RESTRICTION - Your country/region is not supported for Gemini API");
          console.log("   Solution: Use a VPN to connect from a supported country (US, UK, Canada, Australia, etc.)");
          console.log("   More info: https://cloud.google.com/generative-ai/docs/availability");
        } else {
          console.log("   Issue: Access forbidden - check API key permissions");
        }
      } else if (response.status === 429) {
        console.log("   Issue: Rate limited - wait and try again");
      } else if (response.status === 401) {
        console.log("   Issue: Unauthorized - invalid API key");
      }
    }
    
  } catch (error) {
    console.error("   Network error:", error);
    console.log("   Status: Network request failed - check internet connection");
  }
}

async function testOpenAIKey(settings) {
  console.log("1. Testing OpenAI API Key Format...");
  console.log("   Key length:", settings.openaiApiKey.length);
  console.log("   Key format:", settings.openaiApiKey.startsWith("sk-") ? "Valid format (starts with sk-)" : "Invalid format");
  console.log("   Model:", settings.openaiModel);
  
  // Test basic API connectivity
  console.log("\n2. Testing OpenAI API Connectivity...");
  
  const testUrl = "https://api.openai.com/v1/chat/completions";
  const testBody = {
    model: settings.openaiModel,
    messages: [
      { role: "user", content: "Hello, please respond with 'API test successful'" }
    ],
    temperature: 0.1,
    max_tokens: 50
  };
  
  try {
    console.log("   Sending test request...");
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.openaiApiKey}`
      },
      body: JSON.stringify(testBody)
    });
    
    console.log("   Response status:", response.status);
    
    const responseText = await response.text();
    console.log("   Response body:", responseText);
    
    if (response.ok) {
      const data = JSON.parse(responseText);
      if (data.choices && data.choices[0] && data.choices[0].message) {
        const generatedText = data.choices[0].message.content;
        console.log("   Generated text:", generatedText);
        console.log("\n   Status: OpenAI API key is working correctly! ");
      } else {
        console.log("   Status: API responded but no content generated");
      }
    } else {
      console.log("   Status: API call failed");
      
      // Specific error analysis
      if (response.status === 401) {
        console.log("   Issue: Unauthorized - invalid or expired API key");
        console.log("   Solution: Get a new key at https://platform.openai.com/api-keys");
      } else if (response.status === 403) {
        console.log("   Issue: Forbidden - billing issue or insufficient permissions");
        console.log("   Solution: Check your OpenAI billing at https://platform.openai.com/account/billing");
      } else if (response.status === 429) {
        console.log("   Issue: Rate limited - you've hit the API rate limit");
        console.log("   Solution: Wait a moment and try again, or upgrade your plan");
      } else if (response.status === 500 || response.status === 503) {
        console.log("   Issue: OpenAI server error - their servers are having issues");
        console.log("   Solution: Try again in a few moments");
      }
    }
    
  } catch (error) {
    console.error("   Network error:", error);
    console.log("   Status: Network request failed - check internet connection");
  }
}

// Run the diagnostic
if (typeof window !== 'undefined') {
  window.diagnoseApiKey = diagnoseApiKey;
  console.log("API Key Diagnostic loaded. Run diagnoseApiKey() to start.");
  console.log(`
=== Fiverr Assistant API Diagnostic ===

SETUP INSTRUCTIONS:

1. Get an OpenAI API key (RECOMMENDED - Works globally):
   - Visit: https://platform.openai.com/api-keys
   - Sign up if needed (free trial available)
   - Create new secret key
   - Copy the key (starts with 'sk-')
   - Paste in Fiverr Assistant settings

2. Or get a Gemini API key (May have geographic restrictions):
   - Visit: https://aistudio.google.com/app/apikey
   - Create API key
   - Copy the key (starts with 'AIza')
   - Paste in Fiverr Assistant settings

TO TEST:
   1. Open Fiverr in your browser
   2. Open browser console (F12)
   3. Paste this entire script and run: diagnoseApiKey()
   4. Follow the prompts

EXPECTED RESULTS:
   - "API key is working correctly!" = Success ✅
   - "location not supported" = Use VPN 🔒
   - "invalid key" = Check your key ❌
   - "rate limited" = Wait a moment ⏱️

If issues persist, check the LOCATION_RESTRICTION_FIX.md guide.
  `);
}
