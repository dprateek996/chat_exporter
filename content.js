// ============================================
// CONTENT SCRIPT: COMPLETE CHAT EXPORTER (BLOCK-BASED)
// ============================================

// --- 1. BLOCK EXTRACTOR (THE STRUCTURED FIX) ---

function parseDomToBlocks(root) {
  const blocks = [];

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (text) blocks.push({ type: 'text', content: text });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    // --- IMAGES ---
    if (tag === 'img') {
      if (node.width > 50 && !node.src.includes('data:image/svg')) {
        blocks.push({ type: 'image', src: node.src });
      }
      return;
    }

    // --- CODE BLOCKS ---
    if (tag === 'pre') {
      const codeEl = node.querySelector('code') || node;
      const lang = (codeEl.className || '').replace('language-', '') || 'CODE';
      // Push as a dedicated CODE block
      blocks.push({ type: 'code', lang: lang.toUpperCase(), content: codeEl.innerText });
      return; // Don't traverse inside pre
    }

    // --- HEADERS ---
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: 'header', content: node.innerText.trim() });
      return;
    }

    // --- LISTS ---
    if (tag === 'li') {
      blocks.push({ type: 'bullet', content: node.innerText.trim() });
      return;
    }

    // --- TABLE FALLBACK ---
    if (tag === 'table') {
      let tableText = '[TABLE]\n';
      node.querySelectorAll('tr').forEach(tr => {
        tr.querySelectorAll('td, th').forEach(cell => {
          tableText += cell.innerText.trim() + ' | ';
        });
        tableText += '\n';
      });
      blocks.push({ type: 'code', lang: 'TABLE', content: tableText });
      return;
    }

    // Recurse
    for (const child of node.childNodes) {
      traverse(child);
    }

    // Paragraph Breaks
    if (tag === 'p' || tag === 'div' || tag === 'br') {
      blocks.push({ type: 'break' });
    }
  }

  traverse(root);
  return blocks;
}

// --- 2. EXTRACTORS ---

async function extractGeminiContent() {
  console.log('🔍 Extracting Gemini...');
  const turns = document.querySelectorAll('message-content, .message-content, [class*="conversation-turn"]');
  const messages = [];

  for (const turn of turns) {
    const isUser = turn.closest('.user-message') || turn.hasAttribute('data-is-user');
    const role = isUser ? 'user' : 'assistant';

    // Parse into BLOCKS
    const blocks = parseDomToBlocks(turn);
    if (blocks.length > 0) messages.push({ role, blocks });
  }
  return { title: document.title.replace('Gemini', '').trim(), messages };
}

async function extractChatGPTContent() {
  console.log('🔍 Extracting ChatGPT...');
  const articles = document.querySelectorAll('article');
  const messages = [];

  for (const article of articles) {
    const isUser = article.querySelector('[data-message-author-role="user"]');
    const role = isUser ? 'user' : 'assistant';
    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');

    if (contentNode) {
      const blocks = parseDomToBlocks(contentNode);
      // Extra Image Check for ChatGPT
      const extraImages = article.querySelectorAll('img[src^="blob:"], .grid img');
      extraImages.forEach(img => {
        if (img.width > 100) blocks.push({ type: 'image', src: img.src });
      });
      messages.push({ role, blocks });
    }
  }
  return { title: document.title, messages };
}

async function extractConversation() {
  let data = { title: 'Chat Export', messages: [] };

  if (window.location.hostname.includes('gemini.google.com')) {
    data = await extractGeminiContent();
  } else if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('openai.com')) {
    data = await extractChatGPTContent();
  } else if (window.location.hostname.includes('claude.ai')) {
    const elements = document.querySelectorAll('.font-user-message, .font-claude-message');
    const msgs = [];
    elements.forEach(el => {
      const role = el.classList.contains('font-user-message') ? 'user' : 'assistant';
      const blocks = parseDomToBlocks(el);
      if (blocks.length) msgs.push({ role, blocks });
    });
    data = { title: document.title, messages: msgs };
  }

  // Calculate Stats
  data.date = new Date().toLocaleDateString();
  data.stats = {
    total: data.messages.length,
    user: data.messages.filter(m => m.role === 'user').length,
    assistant: data.messages.filter(m => m.role === 'assistant').length,
    words: data.messages.reduce((acc, m) => acc + (m.blocks ? m.blocks.reduce((w, b) => w + (b.content ? b.content.split(/\s+/).length : 0), 0) : 0), 0)
  };

  return data;
}

// --- 3. EXPORTERS (CSP BYPASS & BLOCK RENDERER) ---

async function generatePDF(data) {
  const { jsPDF } = window.jspdf || window;
  if (!jsPDF) { alert("jsPDF library not loaded. Reload extension."); return; }

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  let y = margin;

  // THEME
  const COLORS = {
    userBg: [243, 244, 246], aiBg: [255, 255, 255],
    border: [229, 231, 235], text: [31, 41, 55],
    codeBg: [40, 44, 52], codeText: [220, 220, 220] // Dark Theme for Code
  };

  const checkPage = (h) => {
    if (y + h > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      return true;
    }
    return false;
  };

  // HEADER
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text((data.title || 'Export').substring(0, 50), margin, y);
  y += 20;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(100);
  pdf.text(`${data.date} • ${data.stats.total} Messages`, margin, y);
  y += 30; pdf.setDrawColor(200); pdf.line(margin, y, pageWidth - margin, y); y += 30;

  // --- MESSAGE LOOP ---
  for (const msg of data.messages) {
    if (!msg.blocks || msg.blocks.length === 0) continue;

    const isUser = msg.role === 'user';
    const bubbleWidth = 450;
    const x = isUser ? (pageWidth - margin - bubbleWidth) : margin;
    const padding = 20;
    const contentWidth = bubbleWidth - (padding * 2);

    // 1. CALCULATE HEIGHT (PRE-PASS)
    let estimatedHeight = 0;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');

    msg.blocks.forEach(block => {
      if (block.type === 'text') {
        const lines = pdf.splitTextToSize(block.content, contentWidth);
        estimatedHeight += (lines.length * 14);
      }
      else if (block.type === 'bullet') {
        const lines = pdf.splitTextToSize(block.content, contentWidth - 15);
        estimatedHeight += (lines.length * 14) + 5;
      }
      else if (block.type === 'header') {
        estimatedHeight += 25;
      }
      else if (block.type === 'code') {
        const lines = pdf.splitTextToSize(block.content, contentWidth - 20);
        estimatedHeight += (lines.length * 12) + 20; // + Padding for code box
      }
      else if (block.type === 'image') {
        estimatedHeight += 220;
      }
      else if (block.type === 'break') {
        estimatedHeight += 10;
      }
    });

    estimatedHeight += (padding * 2);
    checkPage(estimatedHeight);

    // 2. DRAW BUBBLE BACKGROUND
    pdf.setFillColor(...(isUser ? COLORS.userBg : COLORS.aiBg));
    pdf.setDrawColor(...COLORS.border);
    pdf.roundedRect(x, y, bubbleWidth, estimatedHeight, 8, 8, 'FD');

    // 3. RENDER CONTENT
    let cy = y + padding + 10;
    let cx = x + padding;

    for (const block of msg.blocks) {
      pdf.setTextColor(...COLORS.text);

      // --- RENDER HEADER ---
      if (block.type === 'header') {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text(block.content, cx, cy);
        cy += 20;
      }

      // --- RENDER TEXT ---
      else if (block.type === 'text') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(block.content, contentWidth);
        for (const line of lines) {
          pdf.text(line, cx, cy);
          cy += 14;
        }
      }

      // --- RENDER BULLET ---
      else if (block.type === 'bullet') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text('•', cx, cy);
        const lines = pdf.splitTextToSize(block.content, contentWidth - 15);
        for (const line of lines) {
          pdf.text(line, cx + 15, cy);
          cy += 14;
        }
        cy += 5;
      }

      // --- RENDER CODE ---
      else if (block.type === 'code') {
        const lines = pdf.splitTextToSize(block.content, contentWidth - 20);
        const codeHeight = (lines.length * 12) + 15;

        pdf.setFillColor(...COLORS.codeBg);
        pdf.rect(cx, cy - 10, contentWidth, codeHeight, 'F');

        pdf.setTextColor(...COLORS.codeText);
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(9);

        let codeY = cy;
        lines.forEach(line => {
          pdf.text(line, cx + 10, codeY);
          codeY += 12;
        });

        cy += codeHeight;
      }

      // --- RENDER IMAGE ---
      else if (block.type === 'image') {
        try {
          if (cy + 160 > pageHeight - margin) { pdf.addPage(); cy = margin; }
          pdf.addImage(block.src, 'JPEG', cx, cy, 200, 150);
          cy += 160;
        } catch (e) { }
      }

      // --- RENDER BREAK ---
      else if (block.type === 'break') {
        cy += 10;
      }
    }

    y += estimatedHeight + 15;
  }

  pdf.save('Premium_Chat_Export.pdf');
}

// Markdown Downloader (Updated for Blocks)
function downloadMarkdown(data) {
  let md = `# ${data.title}\n\n`;
  md += `> **Date:** ${data.date}\n> **Messages:** ${data.stats.total}\n\n---\n\n`;

  data.messages.forEach(msg => {
    const role = msg.role === 'user' ? '👤 **You**' : '🤖 **Assistant**';
    md += `### ${role}\n\n`;

    if (msg.blocks) {
      msg.blocks.forEach(block => {
        if (block.type === 'text') md += `${block.content}\n\n`;
        else if (block.type === 'header') md += `## ${block.content}\n\n`;
        else if (block.type === 'code') md += `\`\`\`${block.lang}\n${block.content}\n\`\`\`\n\n`;
        else if (block.type === 'bullet') md += `* ${block.content}\n`;
        else if (block.type === 'image') md += `![Image](${block.src})\n\n`;
      });
    }
    md += `---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.substring(0, 30)}.md`;
  a.click();
}

// HTML Downloader (Updated for Blocks)
function downloadHTML(data) {
  let html = `<html><head><title>${data.title}</title>
  <style>body{font-family:sans-serif;max-width:800px;margin:2em auto;padding:1em;line-height:1.6}
  .msg{border:1px solid #ddd;padding:1em;margin-bottom:1em;border-radius:8px}
  .user{background:#f0f7ff} .assistant{background:#fff}
  .role{font-weight:bold;margin-bottom:0.5em} 
  pre{background:#282c34;color:#eee;padding:1em;overflow-x:auto;border-radius:4px}
  img{max-width:100%;border-radius:4px;margin:1em 0}
  </style>
  </head><body><h1>${data.title}</h1><p>${data.date} • ${data.stats.total} messages</p><hr>`;

  data.messages.forEach(msg => {
    let content = '';
    if (msg.blocks) {
      msg.blocks.forEach(block => {
        if (block.type === 'text') content += `<p>${block.content}</p>`;
        else if (block.type === 'header') content += `<h3>${block.content}</h3>`;
        else if (block.type === 'code') content += `<pre><code class="language-${block.lang}">${block.content}</code></pre>`;
        else if (block.type === 'bullet') content += `<li>${block.content}</li>`;
        else if (block.type === 'image') content += `<img src="${block.src}">`;
      });
    }
    html += `<div class="msg ${msg.role}"><div class="role">${msg.role}</div>${content}</div>`;
  });

  html += `</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.substring(0, 30)}.html`;
  a.click();
}

// --- 4. UI INJECTION ---

function createFloatingMenu() {
  const existing = document.getElementById('chat-exporter-menu');
  if (existing) return;

  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '999999',
    display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
  });

  const menu = document.createElement('div');
  Object.assign(menu.style, {
    display: 'none', flexDirection: 'column', gap: '8px',
    background: '#2a2a2a', padding: '14px', borderRadius: '14px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #3a3a3a'
  });

  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
  Object.assign(mainBtn.style, {
    padding: '11px 18px', borderRadius: '10px', border: '1px solid #3a3a3a',
    background: '#2a2a2a', color: '#e5e5e5', cursor: 'pointer', fontWeight: 'bold',
    display: 'flex', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
  });

  mainBtn.onclick = () => {
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  };

  const createItem = (icon, label, action) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span style="margin-right:8px;">${icon}</span>${label}`;
    Object.assign(btn.style, {
      padding: '10px 14px', borderRadius: '8px', border: 'none',
      background: '#333', color: '#fff', cursor: 'pointer', textAlign: 'left',
      width: '100%', display: 'flex', alignItems: 'center', marginBottom: '4px'
    });
    btn.onclick = async () => {
      mainBtn.innerText = '⏳ Processing...';
      try {
        const data = await extractConversation();
        if (data.messages.length) await action(data);
        else alert('No messages found');
      } catch (e) { alert('Error: ' + e.message); console.error(e); }
      mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
      menu.style.display = 'none';
    };
    return btn;
  };

  menu.appendChild(createItem('📄', 'PDF', generatePDF));
  menu.appendChild(createItem('📝', 'Markdown', downloadMarkdown));
  menu.appendChild(createItem('🌐', 'HTML', downloadHTML));

  container.appendChild(menu);
  container.appendChild(mainBtn);
  document.body.appendChild(container);
}

new MutationObserver(() => {
  if (!document.getElementById('chat-exporter-menu')) createFloatingMenu();
}).observe(document.body, { childList: true, subtree: true });

createFloatingMenu();

// --- 5. HOST LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportConversation') {
    (async () => {
      try {
        const data = await extractConversation();
        if (data.messages.length) {
          await generatePDF(data);
          sendResponse({ success: true });
        } else {
          alert('No messages found');
          sendResponse({ success: false });
        }
      } catch (e) {
        console.error(e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});
