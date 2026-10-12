EXPAND STUDIO - LOCAL PC PREVIEW

1. Install Node.js 24 LTS from https://nodejs.org/ if it is not installed.
2. Extract the entire ZIP using Windows "Extract All".
3. Open the extracted folder and double-click "Start Expand Studio.bat".
4. Your browser opens the editor. Keep the command window open while editing.
   If the browser does not open, copy the printed address into Edge or Chrome.

No npm install, GitHub checkout, Rust, or API key is needed.
On Mac/Linux, run: node server.mjs, then open the printed address.

TRY A REPAIR
- Open your own PNG/JPEG/WebP or choose "explore with a sample".
- Draw a small rectangle around the area you want to repair.
- Choose Local patch, then drag inside the selection toward clean source pixels.
- Leave Seam blending set to Poisson and click "Blend & apply repair".
- Try Undo/Redo, layer visibility, Export PNG, and Save project.
- Reopen a downloaded .expand project using Open.

Poisson changes sample colors to match the surrounding image. The final blend
can differ from the quick preview. It requires opaque pixels and selection
bounds no larger than 262,144 pixels (for example, 512 by 512).

Save projects before closing. There is no automatic recovery yet.
Browser saves go to your Downloads folder unless the browser asks for a location.

This is a static browser preview, not a native Windows installer. Local editing,
grouped selection tools, Poisson repairs, projects, and PNG export work here.
AI controls require the local service supplied by the source checkout:
git clone --branch codex/expand-studio-preview https://github.com/DearSol/VibeCoder.git
cd VibeCoder
npm ci
npm run dev
Then open the address printed by Vite. See the repository README for provider
keys, model compatibility, charges, and the experimental Kie limitation.
