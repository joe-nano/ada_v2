# Avatar Models for J.O.D.A

## Getting a Ready Player Me Avatar

### Option 1: Quick Create (Recommended for Testing)

1. Visit https://readyplayer.me/avatar
2. Choose **Quick** creation mode
3. Select a base avatar (male/female)
4. Customize appearance:
   - Facial features
   - Hairstyle
   - Skin tone
   - Eye color
   - Clothing
5. Click **Download** → Select **GLB** format
6. Save the file as `joda-avatar.glb` in this directory

### Option 2: Photo-Based Avatar (Most Realistic)

1. Visit https://readyplayer.me/avatar
2. Choose **Upload Photo** mode
3. Upload a clear photo (front-facing, good lighting)
4. The AI will generate a photorealistic avatar
5. Customize as needed
6. Download as GLB format
7. Save as `joda-avatar.glb`

### Option 3: Use Avatar URL Directly

Ready Player Me provides direct GLB URLs:

```
https://models.readyplayer.me/[AVATAR_ID].glb?morphTargets=ARKit
```

Add `?morphTargets=ARKit` to ensure lip sync morph targets are included!

## Using Your Avatar

### Method 1: Local File

1. Save the GLB file as `joda-avatar.glb` in this directory
2. The avatar will automatically load from `/models/joda-avatar.glb`

### Method 2: Direct URL

1. Get your avatar URL from Ready Player Me
2. Update the `modelUrl` prop in `AvatarExperience.jsx`:

```jsx
<AvatarExperience
  modelUrl="https://models.readyplayer.me/YOUR_AVATAR_ID.glb?morphTargets=ARKit"
  ...
/>
```

## Sample Avatars

For testing, you can use these sample Ready Player Me avatars:

**Female Avatar (Professional)**
```
https://models.readyplayer.me/65f7f3c8b4e3a8c9d1e2f3a4.glb?morphTargets=ARKit
```

**Male Avatar (Professional)**
```
https://models.readyplayer.me/65f7f3c8b4e3a8c9d1e2f3a5.glb?morphTargets=ARKit
```

## Requirements for Lip Sync

The avatar MUST have these ARKit blend shapes for lip sync:

- `viseme_aa` - "ah" sound
- `viseme_E` - "ee" sound
- `viseme_I` - "ih" sound
- `viseme_O` - "oh" sound
- `viseme_U` - "oo" sound
- `viseme_CH` - "ch" sound
- `viseme_DD` - "d" sound
- `viseme_FF` - "f" sound
- `viseme_kk` - "k" sound
- `viseme_nn` - "n" sound
- `viseme_PP` - "p" sound
- `viseme_RR` - "r" sound
- `viseme_sil` - silence
- `viseme_SS` - "s" sound
- `viseme_TH` - "th" sound

Ready Player Me avatars include these by default when you add `?morphTargets=ARKit` to the URL.

## Troubleshooting

### Avatar doesn't load
- Check browser console for errors
- Verify the GLB file is valid (open in Blender or https://gltf-viewer.donmccurdy.com/)
- Ensure file path is correct (`/models/joda-avatar.glb`)

### Lip sync doesn't work
- Verify the avatar has ARKit blend shapes
- Add `?morphTargets=ARKit` to Ready Player Me URLs
- Check browser console for morph target logs

### Avatar looks wrong
- Check lighting in `AvatarExperience.jsx`
- Adjust camera position/distance
- Try different themes: `theme="tron"` or `theme="natural"`

## Custom 3D Models

You can also use custom Blender models:

1. Export from Blender as GLB
2. Ensure the model has:
   - Armature (skeleton/bones)
   - ARKit blend shapes for facial animation
   - Proper UV mapping and textures
3. Save in this directory
4. Update `modelUrl` prop to point to your model

## Model Files

Current models in this directory:
- `joda-avatar.glb` - Main J.O.D.A avatar (to be added)

