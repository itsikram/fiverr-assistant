// Test script for Gemini API integration
// This can be run in browser console to test the integration

async function testGeminiIntegration() {
  console.log("Testing Gemini API integration...");
  
  // Mock settings with a test API key (user should replace with their actual key)
  const testSettings = {
    geminiApiKey: "YOUR_GEMINI_API_KEY_HERE", // Replace with actual key
    geminiModel: "gemini-2.5-flash",
    profile: "Test Seller",
    profileUsername: "testseller"
  };
  
  const getSettings = () => testSettings;
  
  try {
    // Test the convertMessagesToGeminiFormat function
    const testMessages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello, can you help me?" }
    ];
    
    console.log("Testing message conversion...");
    const geminiMessages = convertMessagesToGeminiFormat(testMessages);
    console.log("Converted messages:", geminiMessages);
    
    // Test API call (uncomment to actually test with real API key)
    /*
    const response = await geminiGenerateContent(getSettings, testMessages, { temperature: 0.7 });
    console.log("API Response:", response);
    */
    
    console.log("Integration test completed successfully!");
    console.log("To test with real API:");
    console.log("1. Replace YOUR_GEMINI_API_KEY_HERE with your actual Gemini API key");
    console.log("2. Uncomment the API call section");
    console.log("3. Run this script in browser console");
    
  } catch (error) {
    console.error("Integration test failed:", error);
  }
}

// Instructions for user
console.log(`
=== Gemini Integration Test Instructions ===

1. Get a Gemini API key from: https://aistudio.google.com/app/apikey
2. Open Fiverr in your browser
3. Open browser console (F12)
4. Paste this entire script and replace YOUR_GEMINI_API_KEY_HERE
5. Run testGeminiIntegration()

Expected results:
- Message conversion should work
- API call should succeed with valid key
- Response should be generated text

Available Gemini models:
- gemini-2.5-flash (recommended, free tier)
- gemini-2.5-pro (higher quality, may have limits)
- gemini-1.5-flash (older but stable)
- gemini-1.5-pro (older but stable)
`);

// Export for testing
if (typeof window !== 'undefined') {
  window.testGeminiIntegration = testGeminiIntegration;
}
