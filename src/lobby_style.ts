/**
 * CSS for the pre-game lobby (`lobby.ts`). Kept in its own module so the
 * lobby entry can stay focused on the form-state machine; the style block
 * is by far the largest chunk of the original file. Self-contained — only
 * `injectLobbyStyle()` is exported, idempotent so repeated lobby renders
 * (rejection rehydration) don't re-add the `<style>` element.
 */

const STYLE_ID = "anarchy-lobby-style";

const STYLE = `
  #anarchy-lobby {
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse at center, #25303a, #101418);
    color: #f0f0f0;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  #anarchy-lobby .panel {
    background: rgba(20, 24, 30, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 32px 36px;
    min-width: 360px;
    max-width: 90vw;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  }
  #anarchy-lobby h1 {
    margin: 0 0 20px 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.4px;
  }
  #anarchy-lobby .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 4px;
    background: rgba(0, 0, 0, 0.25);
  }
  #anarchy-lobby .tab {
    flex: 1;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: #b8c2cc;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.1s ease, color 0.1s ease;
  }
  #anarchy-lobby .tab:hover { color: #f0f0f0; }
  #anarchy-lobby .tab.active {
    background: #2a3340;
    color: #f0f0f0;
  }
  #anarchy-lobby label {
    display: block;
    font-size: 13px;
    margin-bottom: 8px;
    color: #b8c2cc;
  }
  #anarchy-lobby input[type="text"],
  #anarchy-lobby input[type="password"] {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    background: #0d1014;
    color: #f0f0f0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    font-size: 15px;
    font-family: inherit;
  }
  #anarchy-lobby input:focus {
    outline: none;
    border-color: #5aa0ff;
  }
  #anarchy-lobby .swatches {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin: 12px 0 24px 0;
  }
  #anarchy-lobby .swatch {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition: transform 0.08s ease;
  }
  #anarchy-lobby .swatch:hover { transform: scale(1.04); }
  #anarchy-lobby .swatch.selected {
    border-color: #ffffff;
    box-shadow: 0 0 0 2px #5aa0ff;
  }
  #anarchy-lobby .submit {
    width: 100%;
    padding: 12px;
    background: #4a8fee;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 12px;
  }
  #anarchy-lobby .submit:hover { background: #5aa0ff; }
  #anarchy-lobby .submit:disabled {
    background: #3a4854;
    color: #7a8694;
    cursor: not-allowed;
  }
  #anarchy-lobby .error {
    color: #ff8080;
    font-size: 13px;
    min-height: 18px;
    margin-top: 4px;
  }
  #anarchy-lobby .reject {
    color: #ff8080;
    font-size: 13px;
    margin-bottom: 12px;
    padding: 8px 10px;
    background: rgba(255, 80, 80, 0.08);
    border: 1px solid rgba(255, 80, 80, 0.32);
    border-radius: 6px;
    display: none;
  }
  #anarchy-lobby .reject.visible { display: block; }
  #anarchy-lobby .field-spacer { margin-bottom: 18px; }
  #anarchy-lobby .discord-link {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin-top: 10px;
    padding: 10px;
    background: #5865F2;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  #anarchy-lobby .discord-link:hover { background: #4752C4; }
`;

export function injectLobbyStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}
