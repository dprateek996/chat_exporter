// content.js
let jsPDFInstance = null;

(async () => {
  try {
    const jsPDFScript = document.createElement("script");
    jsPDFScript.src = chrome.runtime.getURL("libs/jspdf.umd.min.js");
    jsPDFScript.type = "text/javascript";
    (document.head || document.documentElement).appendChild(jsPDFScript);
    
    const injectedScript = document.createElement("script");
    injectedScript.src = chrome.runtime.getURL("injected.js");
    injectedScript.type = "text/javascript";
    (document.head || document.documentElement).appendChild(injectedScript);
    
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data.type === 'JSPDF_READY' && event.data.jsPDFAvailable) {
        jsPDFInstance = true;
      }
    });
  } catch (error) {
    console.error("Failed to inject scripts:", error);
  }
})();

// --- TEXT CLEANER ---
function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/Ø[A-Za-z0-9=<>_\-]+/g, "")
    .replace(/[\u00D8\u00DC\u00DD\u00F0\u00FE]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/Copy code/g, "")
    .replace(/\b([A-Z])[ \t]+(?=[A-Z]\b)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMarkdownDom(element) {
  if (!element) return { text: '', codeBlocks: [] };
  
  const clone = element.cloneNode(true);
  const garbage = clone.querySelectorAll('button, svg, .sr-only, .flex.items-center, .copy-code-button');
  garbage.forEach(el => el.remove());

  let structuredText = [];
  let codeBlocks = [];
  const children = clone.childNodes;

  children.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) structuredText.push(t);
    } 
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      const text = node.innerText.trim();

      if (!text) return;

      if (tag === 'p') {
        structuredText.push(text + '\n'); 
      } 
      else if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
        const cleanHeader = text.replace(/\b([A-Z])[\t ](?=[A-Z]\b)/g, "$1");
        structuredText.push('\n' + cleanHeader.toUpperCase() + '\n'); 
      } 
      else if (tag === 'ul' || tag === 'ol') {
        const items = node.querySelectorAll('li');
        items.forEach(li => {
          structuredText.push('• ' + li.innerText.trim());
        });
        structuredText.push('\n'); 
      } 
      else if (tag === 'pre') {
        // CODE BLOCK DETECTION
        const codeElement = node.querySelector('code');
        const codeText = codeElement ? codeElement.innerText : node.innerText;
        const language = codeElement ? (codeElement.className.match(/language-(\w+)/) || [])[1] || 'code' : 'code';
        
        // Store code block separately
        const codeId = `[CODE_BLOCK_${codeBlocks.length}]`;
        codeBlocks.push({
          id: codeId,
          language: language,
          code: codeText.trim()
        });
        
        // Add placeholder in text
        structuredText.push(`\n${codeId}\n`);
      } 
      else if (tag === 'div') {
        structuredText.push(text + '\n');
      }
      else {
        structuredText.push(text);
      }
    }
  });

  return {
    text: structuredText.join('\n'),
    codeBlocks: codeBlocks
  };
}

function extractConversation() {
  const articles = document.querySelectorAll('article');
  const messages = [];
  const titleElement = document.querySelector('h1, [class*="text-2xl"]');
  const title = titleElement ? titleElement.innerText.trim() : 'ChatGPT Conversation';

  articles.forEach((article) => {
    let role = "assistant";
    if (article.querySelector('[data-message-author-role="user"]')) {
      role = "user";
    }

    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');

    if (contentNode) {
      const parsed = parseMarkdownDom(contentNode);
      let cleanedText = cleanText(parsed.text);

      // Extract images
      const images = [];
      contentNode.querySelectorAll('img').forEach(img => {
        if (img.src && !img.src.includes('icon')) {
          images.push({ type: 'img', src: img.src });
        }
      });

      // Extract SVGs (diagrams)
      contentNode.querySelectorAll('svg').forEach(svg => {
        if (svg.getBBox && svg.getBBox().width > 50) {
          const svgClone = svg.cloneNode(true);
          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(svgClone);
          const base64 = btoa(unescape(encodeURIComponent(svgString)));
          const dataUrl = `data:image/svg+xml;base64,${base64}`;
          
          images.push({
            type: 'svg',
            src: dataUrl,
            width: svg.getBBox().width,
            height: svg.getBBox().height
          });
        }
      });

      if (cleanedText) {
        messages.push({ 
          role, 
          text: cleanedText,
          codeBlocks: parsed.codeBlocks,
          images: images.length > 0 ? images : undefined
        });
      }
    }
  });

  const date = new Date().toLocaleString();
  const stats = {
      total: messages.length,
      user: messages.filter(m => m.role === 'user').length,
      assistant: messages.filter(m => m.role === 'assistant').length,
      words: messages.reduce((acc, m) => acc + m.text.split(/\s+/).length, 0)
  };

  return { title, date, stats, messages };
}

// --- EXPORTERS ---

function downloadMarkdown(data) {
    let md = `# ${data.title}\n\n`;
    md += `**Date:** ${data.date} | **Messages:** ${data.stats.total} | **Words:** ${data.stats.words}\n\n---\n\n`;
    
    data.messages.forEach(msg => {
        const role = msg.role === 'user' ? 'User' : 'ChatGPT';
        md += `## ${role}\n\n${msg.text}\n\n`;
        if (msg.images.length > 0) {
            msg.images.forEach(img => {
                if (img.type === 'svg') {
                    md += `![Diagram](${img.src})\n\n`;
                } else {
                    md += `![Image](${img.src})\n\n`;
                }
            });
        }
        md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.md`;
    a.click();
}

function downloadHTML(data) {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>${data.title}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f7f7f8; }
            .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e5e5e5; }
            .stats { font-size: 0.9em; color: #666; }
            .message { margin-bottom: 20px; padding: 15px; border-radius: 8px; }
            .user { background: #fff; border: 1px solid #e5e5e5; }
            .assistant { background: #f7f7f8; border: 1px solid transparent; }
            .role { font-weight: bold; margin-bottom: 5px; color: #333; }
            .content { line-height: 1.6; white-space: pre-wrap; }
            img { max-width: 100%; border-radius: 5px; margin-top: 10px; }
            code { background: #eee; padding: 2px 5px; border-radius: 3px; }
            pre { background: #2d2d2d; color: #fff; padding: 10px; border-radius: 5px; overflow-x: auto; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${data.title}</h1>
            <div class="stats">${data.date} • ${data.stats.total} messages • ${data.stats.words} words</div>
        </div>
    `;

    data.messages.forEach(msg => {
        const roleClass = msg.role;
        const roleName = msg.role === 'user' ? 'You' : 'ChatGPT';
        html += `
        <div class="message ${roleClass}">
            <div class="role">${roleName}</div>
            <div class="content">${msg.text.replace(/\n/g, '<br>')}</div>
            ${msg.images.map(img => {
                if (img.type === 'svg') {
                    return `<img src="${img.src}" style="max-width: 100%; height: auto;" alt="Diagram">`;
                } else {
                    return `<img src="${img.src}">`;
                }
            }).join('')}
        </div>`;
    });

    html += `</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.html`;
    a.click();
}

async function generatePDF(data) {
  let attempts = 0;
  while (!jsPDFInstance && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  
  if (!jsPDFInstance) {
    alert("PDF Library loading... please try again.");
    return;
  }

  window.postMessage({ type: 'GENERATE_PDF', data }, '*');
}

// --- UI ---

function createFloatingMenu() {
  if (document.getElementById("chatgpt-exporter-menu")) return;

  const container = document.createElement("div");
  container.id = "chatgpt-exporter-menu";
  Object.assign(container.style, {
    position: "fixed", bottom: "20px", right: "20px", zIndex: "999999",
    display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end"
  });

  const mainBtn = document.createElement("button");
  mainBtn.textContent = "Export Chat";
  Object.assign(mainBtn.style, {
    padding: "10px 16px", borderRadius: "999px", border: "none",
    background: "#10a37f", color: "#fff", cursor: "pointer", fontWeight: "bold",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)", fontSize: "14px"
  });

  const menuItems = document.createElement("div");
  Object.assign(menuItems.style, {
    display: "none", flexDirection: "column", gap: "8px", marginBottom: "10px",
    background: "white", padding: "10px", borderRadius: "12px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)", border: "1px solid #e5e5e5"
  });

  const createItem = (text, onClick) => {
      const btn = document.createElement("button");
      btn.textContent = text;
      Object.assign(btn.style, {
          padding: "8px 12px", borderRadius: "6px", border: "1px solid #eee",
          background: "white", color: "#333", cursor: "pointer", width: "100%",
          textAlign: "left", fontSize: "13px", transition: "background 0.2s"
      });
      btn.onmouseover = () => btn.style.background = "#f7f7f8";
      btn.onmouseout = () => btn.style.background = "white";
      btn.onclick = async () => {
          mainBtn.textContent = "Processing...";
          const data = extractConversation();
          if (data.messages.length === 0) {
              alert("No messages found.");
              mainBtn.textContent = "Export Chat";
              return;
          }
          await onClick(data);
          mainBtn.textContent = "Export Chat";
          menuItems.style.display = "none";
      };
      return btn;
  };

  menuItems.appendChild(createItem("📄 PDF (Styled)", generatePDF));
  menuItems.appendChild(createItem("📝 Markdown", downloadMarkdown));
  menuItems.appendChild(createItem("🌐 HTML", downloadHTML));

  mainBtn.onclick = () => {
      const isHidden = menuItems.style.display === "none";
      menuItems.style.display = isHidden ? "flex" : "none";
  };

  container.appendChild(menuItems);
  container.appendChild(mainBtn);
  document.body.appendChild(container);
}

// Use MutationObserver to handle SPA navigation
const observer = new MutationObserver(() => {
  if (document.querySelector('main') && !document.getElementById("chatgpt-exporter-menu")) {
    createFloatingMenu();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
createFloatingMenu();
