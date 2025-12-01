// content.js

console.log("[ChatGPT Exporter] content script loaded");


// -----------------------------
// Extract ChatGPT Conversation
// -----------------------------
function extractConversation() {
  const nodes = document.querySelectorAll("[data-message-author-role]");

  const messages = [];

  nodes.forEach(node => {
    const role = node.getAttribute("data-message-author-role") || "assistant";
    const text = node.innerText.trim();

    if (!text) return; // skip empty blocks

    messages.push({ role, text });
  });

  return messages;
}

// -----------------------------------------
// Auto-scroll to load full ChatGPT history
// -----------------------------------------
// -----------------------------------------
// Auto-scroll actual ChatGPT chat container
// -----------------------------------------
async function loadFullConversation() {
  console.log("[ChatGPT Exporter] Loading full conversation...");

  // Correct scroll container
  const scrollContainer = document.querySelector("main#main.overflow-auto");

  if (!scrollContainer) {
    console.warn("[ChatGPT Exporter] ERROR: Scroll container not found.");
    return;
  }

  let previousHeight = -1;

  return new Promise(resolve => {
    const interval = setInterval(() => {
      try {
        scrollContainer.scrollTo({ top: 0, behavior: "auto" });
      } catch (err) {}

      const currentHeight = scrollContainer.scrollHeight;

      if (currentHeight === previousHeight) {
        clearInterval(interval);
        console.log("[ChatGPT Exporter] Full conversation loaded.");
        resolve();
      }

      previousHeight = currentHeight;
    }, 500);
  });
}
// -----------------------------
// Create Floating Button
// -----------------------------
function createFloatingButton() {
  if (document.getElementById("chatgpt-exporter-button")) return;

  const btn = document.createElement("button");
  btn.id = "chatgpt-exporter-button";
  btn.textContent = "Export Chat (PDF)";

  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "999999",
    padding: "10px 16px",
    borderRadius: "999px",
    border: "none",
    background: "#10a37f",
    color: "#ffffff",
    fontSize: "14px",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.boxShadow = "0 6px 18px rgba(0,0,0,0.25)";
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  });

  btn.addEventListener("click", async () => {
  console.log("[ChatGPT Exporter] Starting full export...");

  // 1) Load full chat history
  await loadFullConversation();

  // 2) Extract messages
  const messages = extractConversation();

  console.log(messages);
  alert(`Found ${messages.length} messages. Check console.`);
});
  document.body.appendChild(btn);
}


// -----------------------------
// Run on load (SPA safe-ish for now)
// -----------------------------
createFloatingButton();