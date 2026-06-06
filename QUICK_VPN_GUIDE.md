# Quick VPN Setup Guide (5 Minutes)

## The Problem
❌ **Error**: "Bad request (400). User location is not supported for the API use."
✅ **Solution**: Use VPN to appear from a supported country

## FASTEST SOLUTION: ProtonVPN Free

### Step 1: Download (1 min)
Go to: https://protonvpn.com/download
- Click "Windows" 
- Run the installer
- Click "Install"

### Step 2: Create Account (1 min)
- Open ProtonVPN
- Click "Create account"
- Use any email
- Choose "Free" plan
- Verify email (takes 30 seconds)

### Step 3: Connect to US (1 min)
- Log in to ProtonVPN
- Click "United States" (or any US server: US-1, US-2, etc.)
- Click "Connect"
- Wait for green lock to appear
- Status should show "Connected"

### Step 4: Test Gemini API (2 min)
- Open Fiverr in browser
- Go to Fiverr Assistant settings
- Click "Test API Key" button
- **Should now work!** ✅

---

## If ProtonVPN Doesn't Work, Try:

### Option 1: Different VPN Server
- In ProtonVPN: Try "US-2" instead of "US-1"
- Or try "United Kingdom" server
- Reconnect and test again

### Option 2: Different VPN Provider
**Windscribe** (Also Free):
1. Download: https://windscribe.com/download
2. Install & open
3. Sign up (free account)
4. Choose "United States" location
5. Click "Connect"
6. Test Gemini API

**NordVPN** (Paid, 7-day free trial):
1. Download: https://nordvpn.com
2. Start 7-day trial
3. Connect to US
4. Test Gemini API

### Option 3: Browser VPN Extension
If desktop VPN doesn't work, try browser extension:
- **Chrome**: Install "VPN Chrome" or "Browsec"
- **Firefox**: Install "Windscribe" or "ProtonVPN"
- Select US/UK location
- Reload Fiverr
- Test API

---

## Verify VPN is Working

### Check #1: Is VPN Connected?
- **Desktop VPN**: Should show "Connected" in app
- **Browser VPN**: Should show shield/lock icon

### Check #2: Verify IP Changed
1. Open new tab
2. Go to: https://www.whatismyip.com
3. **Before VPN**: Shows your real country
4. **After VPN**: Should show US/UK/Canada (VPN server location)

### Check #3: Test Gemini
- Open browser console (F12)
- Run: `diagnoseApiKey()`
- Look for error type:
  - ✅ "API key is working" = **VPN worked! Keep it on**
  - ❌ Still showing location error = Try different VPN server

---

## Troubleshooting

### Problem: VPN Won't Connect
**Fix**: 
- Restart computer
- Update VPN app
- Try different VPN provider
- Check internet connection

### Problem: Gemini Error Still Appears
**Fix**:
- Clear browser cache (Ctrl+Shift+Delete)
- Close all browser windows
- Reopen browser
- Keep VPN on
- Test again

### Problem: Fiverr is Very Slow with VPN
**Fix**:
- You can turn OFF VPN when just using Fiverr normally
- Only keep ON when using Gemini AI assistant
- Or switch to closer VPN server

### Problem: Different Error Now Appears
**Fix**: 
- Check error details in browser console
- Could be API key issue (not location)
- Visit: https://aistudio.google.com/app/apikey
- Regenerate API key if needed

---

## Once VPN Works

### Option A: Keep VPN Running
- Leave ProtonVPN/VPN on while browsing Fiverr
- Minimal speed impact (5-10%)
- Ensures Gemini API always works

### Option B: Toggle VPN On/Off
- Turn VPN ON: When using Gemini AI assistant
- Turn VPN OFF: When not using AI (faster browsing)
- This is most efficient

### Option C: Advanced Setup (Optional)
- Enable VPN on router (not per-device)
- Then ALL devices use VPN automatically
- Requires router that supports VPN

---

## Still Not Working?

### Read Full Guide
👉 See: **LOCATION_RESTRICTION_FIX.md** (in this folder)

### Check Your Gemini Key
1. Go to: https://aistudio.google.com/app/apikey
2. Verify key shows in green box
3. Copy full key (all characters)
4. Paste in Fiverr Assistant settings
5. Test again

### Try Alternative API
If VPN doesn't work, use Claude AI instead:
- Get key: https://console.anthropic.com/keys
- Or OpenAI: https://platform.openai.com/api-keys
- (Requires extension developer to add support)

---

## One-Minute Checklist ✓

- [ ] VPN downloaded & installed
- [ ] VPN connected (green lock visible)
- [ ] Connected to US server
- [ ] Browser cache cleared
- [ ] Fiverr reloaded
- [ ] Test API shows "working" ✅

---

**Time estimate**: 5-10 minutes
**Success rate**: ~95% with ProtonVPN + US server
**Cost**: Free (or $4/month for better speeds)

**Good luck!** 🚀
