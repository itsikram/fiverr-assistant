// API Key Diagnostic Test for Fiverr Assistant
// Run this in browser console to test your new API key

async function diagnoseApiKey() {
  console.log("=== Gemini API Key Diagnostic ===\n");
  
  // Get current settings from extension
  let settings;
  try {
    // Try to get settings from browser storage
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      const stored = await browser.storage.local.get(['geminiApiKey', 'geminiModel']);
      settings = {
        geminiApiKey: stored.geminiApiKey || '',
        geminiModel: stored.geminiModel || 'gemini-2.5-flash'
      };
    } else {
      // Fallback for testing - user needs to enter key manually
      settings = {
        geminiApiKey: prompt("Enter your Gemini API key to test:"),
        geminiModel: 'gemini-2.5-flash'
      };
    }
    
    if (!settings.geminiApiKey) {
      console.error("No API key found. Please set your API key in extension settings first.");
      return;
    }
    
  } catch (error) {
    console.error("Error accessing settings:", error);
    return;
  }
  
  console.log("1. Testing API Key Format...");
  console.log("   Key length:", settings.geminiApiKey.length);
  console.log("   Key format:", settings.geminiApiKey.startsWith("AIza") ? "Valid format (starts with AIza)" : "Invalid format");
  console.log("   Model:", settings.geminiModel);
  
  // Test basic API connectivity
  console.log("\n2. Testing API Connectivity...");
  
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
        console.log("\n   Status: API key is working correctly! ");
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
        }
      } else if (response.status === 403) {
        console.log("   Issue: Access forbidden - check API key permissions");
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
  
  // Test model availability
  console.log("\n3. Testing Model Availability...");
  const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${settings.geminiApiKey}`;
  
  try {
    const modelsResponse = await fetch(modelsUrl);
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json();
      const availableModels = modelsData.models.map(m => m.name.split('/').pop());
      console.log("   Available models:", availableModels);
      
      if (availableModels.includes(settings.geminiModel)) {
        console.log("   Status: Selected model is available");
      } else {
        console.log("   Status: Selected model not available. Try:", availableModels[0]);
      }
    } else {
      console.log("   Status: Could not fetch model list");
    }
  } catch (error) {
    console.log("   Status: Model check failed");
  }
  
  console.log("\n=== Diagnostic Complete ===");
  console.log("If issues persist:");
  console.log("1. Verify API key at: https://aistudio.google.com/app/apikey");
  console.log("2. Check if key is enabled for the Gemini API");
  console.log("3. Ensure you haven't exceeded quota limits");
  console.log("4. Try a different model (gemini-1.5-flash, gemini-1.5-pro)");
}

// Run the diagnostic
if (typeof window !== 'undefined') {
  window.diagnoseApiKey = diagnoseApiKey;
  console.log("API Key Diagnostic loaded. Run diagnoseApiKey() to start.");
}
