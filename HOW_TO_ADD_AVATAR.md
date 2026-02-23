# How to Add Your Beautiful 3D Avatar

## Quick Start (5 minutes)

### Step 1: Create Your Avatar

Visit: **https://readyplayer.me/avatar**

Choose one of these options:
1. **Upload a Photo** (Recommended) - Most realistic
2. **Quick Create** - Customize from scratch
3. **Use Webcam** - Take a photo directly

### Step 2: Customize (Optional)

- Adjust facial features
- Change hairstyle and color
- Modify clothing
- Set skin tone and eye color

### Step 3: Download Your Avatar

1. Click the **Download** button
2. Select **GLB** format
3. **IMPORTANT**: The URL should include `?morphTargets=ARKit` for lip sync
4. Save the file

### Step 4: Add to J.O.D.A

**Option A: Save Locally** (Recommended)
```bash
# Move your downloaded avatar to J.O.D.A
mv ~/Downloads/your-avatar.glb /root/Desktop/joda_ai_local/public/models/joda-avatar.glb
```

**Option B: Use Direct URL**
1. Instead of downloading, copy the GLB URL from Ready Player Me
2. In J.O.D.A, click the User icon (👤) on the visualizer
3. Select "Beautiful 3D" mode
4. Paste the URL in "Custom Model URL"
5. Make sure the URL ends with: `?morphTargets=ARKit&textureAtlas=1024`

### Step 5: Restart J.O.D.A (if using local file)

```bash
cd /root/Desktop/joda_ai_local
# Kill current instance
if [ -f .joda.pid ]; then cat .joda.pid | xargs kill -9 2>/dev/null; rm .joda.pid; fi
# Start fresh
./start-joda.sh
```

### Step 6: Activate Beautiful Mode

1. Access J.O.D.A in your browser
2. Look for the avatar mode selector (top-right of visualizer)
3. Click the **✨ Beautiful** button
4. Your avatar should appear!

---

## Troubleshooting

### "Blank screen when clicking Beautiful button"

**Cause**: No avatar model loaded yet

**Solution**: You're seeing the fallback mode. Follow steps above to add an avatar.

### "Avatar doesn't have lip sync"

**Cause**: Missing ARKit morph targets

**Solution**: Make sure your Ready Player Me URL includes:
```
?morphTargets=ARKit
```

Example correct URL:
```
https://models.readyplayer.me/YOUR-ID.glb?morphTargets=ARKit&textureAtlas=1024
```

### "Avatar looks wrong or has missing textures"

**Cause**: Texture atlas not optimized

**Solution**: Add texture atlas parameter:
```
&textureAtlas=1024
```

### "Model won't load"

1. Check the file exists:
   ```bash
   ls -lh /root/Desktop/joda_ai_local/public/models/joda-avatar.glb
   ```

2. Verify it's a valid GLB file (should be > 1MB):
   ```bash
   file /root/Desktop/joda_ai_local/public/models/joda-avatar.glb
   ```

3. Check browser console for errors (F12 → Console tab)

---

## Alternative: Use Sample Avatars

If you want to test quickly without creating your own:

### Create a FREE Ready Player Me Account

1. Go to https://readyplayer.me
2. Click "Sign Up" (free)
3. Create an avatar
4. Access your avatar library
5. Download any avatar you've created

### Or Use Blender

If you have a custom 3D model:

1. Open in Blender
2. Ensure it has:
   - Armature (skeleton)
   - ARKit blend shapes for facial animation
   - Proper UV mapping
3. Export as GLB (File → Export → glTF 2.0)
4. Save to `/root/Desktop/joda_ai_local/public/models/joda-avatar.glb`

---

## What You'll Get

Once your avatar is loaded:

✨ **High-Quality 3D Rendering**
- Studio lighting (key, fill, rim)
- Realistic materials and shadows
- Tron-themed electric blue aesthetic

🎬 **Post-Processing Effects**
- Bloom (neon glow)
- Depth of field (cinematic blur)
- SSAO (ambient occlusion for depth)

💬 **Lip Sync** (when ElevenLabs API is configured)
- Phoneme-based mouth movement
- ARKit blend shapes
- Realistic speech animation

🎮 **Interactive Controls**
- Drag to rotate
- Scroll to zoom
- Click and pan

🎨 **Customizable Themes**
- Tron (electric blue, dark)
- Natural (warm, soft lighting)
- Studio (professional photography)

---

## Advanced: Enable Premium Lip Sync

For the best lip sync experience:

1. Get ElevenLabs API key: https://elevenlabs.io (free tier available)

2. Add to `.env`:
   ```bash
   echo "ELEVENLABS_API_KEY=your_key_here" >> /root/Desktop/joda_ai_local/.env
   ```

3. Restart J.O.D.A

4. The system will automatically use high-quality TTS with perfect lip sync

---

## Need Help?

- Check: `/root/Desktop/joda_ai_local/BEAUTIFUL_AVATAR_IMPLEMENTATION.md`
- Docs: `/root/Desktop/joda_ai_local/public/models/README.md`
- Ready Player Me: https://docs.readyplayer.me

Your beautiful avatar awaits! 🎭✨
