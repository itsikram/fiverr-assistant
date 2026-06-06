# Fixing "User Location is Not Supported" Error

## Problem
You're getting a **400 or 403 Bad Request** error saying "User location is not supported for the API use." This means Google's Gemini API is blocking your requests based on your geographic location/country.

## Root Cause
Gemini API (Google's generative AI API) is **not available in all countries**. Google restricts access based on:
- Your actual geographic location
- Your ISP's registration country  
- Potential legal/regulatory restrictions in your region

## Supported Regions
Gemini API is primarily available in:
- ✅ United States
- ✅ United Kingdom
- ✅ Canada
- ✅ Australia
- ✅ Japan
- ✅ Singapore
- ✅ Many EU countries (varies)

Check full list: https://cloud.google.com/generative-ai/docs/availability

## Solutions

### Solution 1: Use a VPN (RECOMMENDED & EASIEST)
1. **Download a VPN service**:
   - ProtonVPN (free tier available)
   - NordVPN
   - ExpressVPN
   - CyberGhost
   - Windscribe (free)

2. **Connect to a supported country**:
   - Try US servers first (most reliable for Gemini API)
   - UK, Canada, Australia also work

3. **Clear browser cache** and reload Fiverr:
   - Press `Ctrl+Shift+Delete` to open Clear Browsing Data
   - Select "All time"
   - Check all boxes
   - Click Clear

4. **Test your connection**:
   - Open Fiverr Assistant settings
   - Click "Test API Key" button
   - Should now work

**Why VPN works**: It masks your real IP/location, so Google sees you connecting from the VPN's server location (which is in a supported country).

### Solution 2: Alternative AI APIs (If VPN Doesn't Work)
If VPN doesn't work or isn't practical, switch to alternative APIs:

#### Option A: Claude AI (Anthropic)
- Get API key: https://console.anthropic.com/keys
- Available in most countries
- Better at writing natural inbox replies

#### Option B: OpenAI ChatGPT
- Get API key: https://platform.openai.com/api-keys
- Available in most countries
- Most reliable and widely supported

#### Option C: Replicate API
- Get API key: https://replicate.com/account/api-tokens
- Works globally

### Solution 3: Use Different Gemini Models
Sometimes specific model endpoints work better:
```
Try these models instead:
- gemini-1.5-pro (older, sometimes less restricted)
- gemini-1.5-flash
- gemini-pro (if available)
```

In settings, change the model to try different endpoints.

### Solution 4: Mobile Hotspot (Temporary Test)
1. Use your phone's mobile hotspot
2. If it works, your ISP may be the issue
3. Contact your ISP or consider a more persistent VPN

## Step-by-Step VPN Setup (Windows)

### Using ProtonVPN (Free - Recommended for Testing)

1. **Download ProtonVPN**: https://protonvpn.com/download
2. **Install and open it**
3. **Create account** (free tier available)
4. **Connect to US server**:
   - Click the server list
   - Select "United States"
   - Click "Connect"
   - Wait for connection (lock icon should appear)
5. **Test Gemini API**:
   - Open browser console (F12)
   - Run: `diagnoseApiKey()`
   - Should now work

### Disable VPN After Testing
- Once you verify it works, you can turn off VPN
- Or keep it running for all Gemini API calls

## Diagnosing the Issue

### Check Your API Response
1. **Open browser console**: Press `F12`
2. **Go to Console tab**
3. **Run diagnostic**:
   ```javascript
   diagnoseApiKey()
   ```
4. **Look for these clues in output**:
   - "location" error = Geographic restriction ➜ Use VPN
   - "api.key.invalid" = Wrong API key ➜ Get new key
   - "permission" = API not enabled ➜ Enable in Google Cloud
   - "quota exceeded" = Rate limited ➜ Wait or upgrade billing

### Check Your VPN Connection
1. **Verify VPN is connected**:
   - Check VPN app status (should show "Connected")
   - Look for lock icon in system tray
2. **Check your visible IP**:
   - Visit https://www.whatismyip.com
   - Should show VPN server country
3. **Verify browser uses VPN**:
   - Most browsers automatically use system VPN
   - Some may need VPN extension

## Common Issues & Fixes

### Issue: Error persists even with VPN
- **Solution**: Try a different VPN server (switch from US-1 to US-2, etc.)
- **Solution**: Clear browser cache (Ctrl+Shift+Delete)
- **Solution**: Restart browser completely
- **Solution**: Try incognito/private mode

### Issue: VPN is slow
- **Solution**: Choose a closer server (geographically)
- **Solution**: Switch between VPN providers
- **Solution**: Use a paid VPN for better speeds

### Issue: Getting different error now
- **Solution**: Check the new error message in console
- **Solution**: Verify your API key format (should start with "AIza")
- **Solution**: Make sure billing is enabled on Google Cloud

### Issue: Works with VPN but want permanent solution
- **Solution**: Get billing set up on Google Cloud (enables better access)
- **Solution**: Keep VPN running 24/7 using your router (requires router support)
- **Solution**: Switch to Claude or OpenAI API (permanent solution)

## Switching to Claude AI (Claude Setup)

If you want a permanent solution without VPN:

### Get Claude API Key
1. Visit: https://console.anthropic.com/keys
2. Create an account
3. Generate API key
4. Copy the key

### Update Extension (Instructions TBD)
Contact developer to add Claude API support to the extension.

## FAQ

**Q: Will using VPN get me banned?**
A: No, VPN is perfectly legal and widely used. You're not violating TOS.

**Q: Will VPN affect my browsing speed on Fiverr?**
A: Minimal impact on Fiverr browsing (API calls are fast). Overall browsing may be 5-20% slower.

**Q: Is free VPN safe?**
A: For testing, yes. ProtonVPN's free tier is reputable. Avoid sketchy free VPNs.

**Q: Do I need VPN running all the time?**
A: No, only when using the AI assistant. You can toggle it on/off.

**Q: What if none of this works?**
A: 
- Try Claude AI or OpenAI instead (permanent solutions)
- Contact extension developer for help
- Check Google's official docs: https://cloud.google.com/generative-ai/docs

## References

- Gemini API Availability: https://cloud.google.com/generative-ai/docs/availability
- Google AI Studio (Check your key): https://aistudio.google.com/app/apikey
- ProtonVPN: https://protonvpn.com/
- Claude API: https://console.anthropic.com/
- OpenAI API: https://platform.openai.com/

---

**Last Updated**: 2026-06-06
**Issue**: Geographic location restrictions on Gemini API access
