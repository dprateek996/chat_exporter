/**
 * AI Chat Exporter - Export conversations from ChatGPT & Gemini to PDF
 * Version: 2.0.0 - Production Ready
 */

// ============================================
// STATE & DETECTION
// ============================================

let jsPDFInstance = null;
let jsPDFLib = null;
const isGemini = location.hostname.includes('gemini.google.com');
const isChatGPT = location.hostname.includes('chatgpt.com') || location.hostname.includes('openai.com');

// UI patterns to filter out from extraction
const UI_PATTERNS = [
  /^gemini$/i, /^copy$/i, /^share$/i, /^edit$/i, /^listen$/i,
  /^tools$/i, /^recent$/i, /^gems$/i, /^help$/i, /^settings$/i,
  /^new chat$/i, /^pro$/i, /^show thinking/i, /^thinking/i,
  /^add files$/i, /^explore gems$/i, /^more options$/i,
  /^double-check/i, /^report/i, /^invite a friend/i,
  /gemini can make mistakes/i, /^\+$/, /^choose your model/i
];

// ============================================
// LIBRARY LOADING
// ============================================

(async () => {
  try {
    if (isGemini) {
      console.log('📚 Loading jsPDF for Gemini...');
      const jsPDFUrl = chrome.runtime.getURL('libs/jspdf.umd.min.js');
      await import(jsPDFUrl);
      
      if (window.jspdf?.jsPDF) {
        jsPDFLib = window.jspdf.jsPDF;
        jsPDFInstance = true;
        console.log('✅ jsPDF loaded successfully');
      }
      return;
    }
    
    // For ChatGPT - use script injection
    const jsPDFScript = document.createElement('script');
    jsPDFScript.src = chrome.runtime.getURL('libs/jspdf.umd.min.js');
    document.head.appendChild(jsPDFScript);
    
    jsPDFScript.onload = () => {
      const injectedScript = document.createElement('script');
      injectedScript.src = chrome.runtime.getURL('injected.js');
      document.head.appendChild(injectedScript);
    };
    
    window.addEventListener('message', (event) => {
      if (event.source === window && event.data.type === 'JSPDF_READY') {
        jsPDFInstance = true;
      }
    });
  } catch (error) {
    console.error('❌ Failed to load jsPDF:', error);
  }
})();

// ============================================
// UTILITY FUNCTIONS
// ============================================

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Clean text by removing garbage characters and fixing spacing
 */
function cleanText(text) {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove garbage/corrupted characters
  cleaned = cleaned
    .replace(/[Ø][=<>]?[ÞþßÜÄŸ€]?[A-Z€]?/g, '')
    .replace(/[֍þãÜÀŸ¢ßØÞ€]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  
  // Fix spaced-out text (like "H e l l o" -> "Hello")
  for (let i = 0; i < 5; i++) {
    cleaned = cleaned
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6$7$8')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3');
  }
  
  return cleaned.replace(/  +/g, ' ').trim();
}

/**
 * Check if line should be filtered (UI element)
 */
function shouldFilterLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (UI_PATTERNS.some(p => p.test(trimmed))) return true;
  if (/^[+\-•]$/.test(trimmed)) return true;
  return false;
}

// ============================================
// GEMINI EXTRACTION
// ============================================

async function extractGeminiContent() {
  console.log('🔍 Extracting Gemini conversation...');
  
  // Scroll to load content
  for (let i = 0; i < 15; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(200);
  }
  window.scrollTo(0, 0);
  await wait(300);
  
  // Get title
  let title = document.title?.replace(' - Google', '').replace('Gemini', '').trim() || 'Gemini Conversation';
  
  // Try specific response selectors first
  const selectors = [
    '[class*="response-container"]',
    '[class*="model-response"]', 
    '[class*="markdown-content"]',
    '[class*="message-content"]',
    '.prose'
  ];
  
  let extractedText = '';
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      const texts = [];
      for (const el of elements) {
        if (el.closest('nav, aside, [class*="sidebar"]')) continue;
        const text = el.innerText?.trim();
        if (text && text.length > 100) texts.push(text);
      }
      if (texts.length > 0) {
        extractedText = texts.join('\n\n');
        break;
      }
    }
  }
  
  // Fallback: main content
  if (!extractedText || extractedText.length < 100) {
    const main = document.querySelector('main');
    if (main) {
      const clone = main.cloneNode(true);
      clone.querySelectorAll('nav, aside, [class*="sidebar"], [class*="drawer"], button').forEach(el => el.remove());
      extractedText = clone.innerText || '';
    }
  }
  
  // Clean the text
  const lines = extractedText.split('\n');
  const cleanedLines = [];
  let foundContent = false;
  
  for (let line of lines) {
    line = line.trim();
    
    if (!line) {
      if (foundContent && cleanedLines[cleanedLines.length - 1] !== '') {
        cleanedLines.push('');
      }
      continue;
    }
    
    if (shouldFilterLine(line)) continue;
    
    // Skip user prompts at start
    if (!foundContent && /^(give me|generate|create|make|write|list|explain|tell me|show me|help|what|how|why)/i.test(line)) {
      continue;
    }
    
    line = cleanText(line);
    
    // Normalize various bullet characters to standard bullet
    line = line.replace(/^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u2713\u2714\u2715\u2716\u27A4\u25B6\u25BA●○◦◉◆◇▪▫★☆→➤➔►]\s*/g, '• ');
    line = line.replace(/^\*\s+/g, '• '); // Markdown asterisk bullets
    line = line.replace(/^-\s+/g, '• '); // Dash bullets
    
    if (line) {
      if (line.length > 50 || /^\d+\.\s+/.test(line) || /^•\s+/.test(line)) {
        foundContent = true;
      }
      cleanedLines.push(line);
    }
  }
  
  const finalText = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  
  console.log(`📊 Extracted ${finalText.length} characters`);
  
  return {
    title,
    messages: finalText.length > 50 ? [{
      role: 'assistant',
      text: finalText,
      codeBlocks: [],
      images: []
    }] : []
  };
}

// ============================================
// CHATGPT EXTRACTION
// ============================================

async function extractChatGPTContent() {
  console.log('🔍 Extracting ChatGPT conversation...');
  
  const articles = document.querySelectorAll('article');
  const messages = [];
  const titleEl = document.querySelector('h1, [class*="text-2xl"]');
  const title = titleEl?.innerText?.trim() || 'ChatGPT Conversation';
  
  articles.forEach(article => {
    let role = 'assistant';
    if (article.querySelector('[data-message-author-role="user"]')) {
      role = 'user';
    }
    
    const contentNode = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');
    
    if (contentNode) {
      // Clone and clean
      const clone = contentNode.cloneNode(true);
      clone.querySelectorAll('button, svg, .sr-only').forEach(el => el.remove());
      
      let text = '';
      const codeBlocks = [];
      
      clone.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent.trim();
          if (t) text += t + '\n';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          const content = node.innerText?.trim();
          if (!content) return;
          
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            const code = (codeEl || node).innerText.trim();
            const lang = (codeEl?.className.match(/language-(\w+)/) || [])[1] || 'code';
            const id = `[CODE_${codeBlocks.length}]`;
            codeBlocks.push({ id, language: lang, code });
            text += '\n' + id + '\n';
          } else if (['h1','h2','h3','h4'].includes(tag)) {
            text += '\n## ' + content + '\n';
          } else if (tag === 'ul' || tag === 'ol') {
            node.querySelectorAll('li').forEach((li, idx) => {
              text += (tag === 'ol' ? `${idx+1}. ` : '• ') + li.innerText.trim() + '\n';
            });
          } else {
            text += content + '\n';
          }
        }
      });
      
      text = cleanText(text);
      if (text) {
        messages.push({ role, text, codeBlocks, images: [] });
      }
    }
  });
  
  return { title, messages };
}

// ============================================
// MAIN EXTRACTION
// ============================================

async function extractConversation() {
  let result;
  
  if (isGemini) {
    result = await extractGeminiContent();
  } else if (isChatGPT) {
    result = await extractChatGPTContent();
  } else {
    result = { title: 'Conversation', messages: [] };
  }
  
  const date = new Date().toLocaleString();
  const stats = {
    total: result.messages.length,
    user: result.messages.filter(m => m.role === 'user').length,
    assistant: result.messages.filter(m => m.role === 'assistant').length,
    words: result.messages.reduce((acc, m) => acc + (m.text?.split(/\s+/).length || 0), 0)
  };
  
  return { title: result.title, date, stats, messages: result.messages };
}

// ============================================
// PDF GENERATION
// ============================================

function generatePDFInContentScript(data) {
  if (!jsPDFLib) {
    alert('PDF library not loaded. Please refresh.');
    return;
  }
  
  try {
    const pdf = new jsPDFLib({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;
    
    const ensureSpace = (needed = 20) => {
      if (y + needed > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
    };
    
    // Title
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.setTextColor(0, 0, 0);
    pdf.text(data.title, margin, y);
    y += 25;
    
    // Metadata
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`${data.date} • ${data.stats.total} messages • ${data.stats.words} words`, margin, y);
    y += 15;
    
    // Separator
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 25;
    
    // Process messages
    for (const msg of data.messages) {
      if (isGemini && msg.role === 'user') continue;
      
      let text = msg.text || '';
      if (!text) continue;
      
      // Replace code placeholders
      if (msg.codeBlocks?.length) {
        msg.codeBlocks.forEach(b => {
          text = text.replace(b.id, `\n[CODE: ${b.language}]\n${b.code}\n[/CODE]\n`);
        });
      }
      
      // Render text
      const lines = text.split('\n');
      const lineHeight = 14;
      const fontSize = 11;
      let inCode = false;
      
      for (const rawLine of lines) {
        const line = rawLine.trim();
        
        if (!line) { y += 8; continue; }
        
        ensureSpace(lineHeight + 10);
        
        // Headers
        if (line.startsWith('## ')) {
          y += 10;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(14);
          pdf.setTextColor(0, 0, 0);
          pdf.text(line.replace(/^##\s*/, ''), margin, y);
          y += 20;
          pdf.setFontSize(fontSize);
          pdf.setTextColor(30, 30, 30);
          continue;
        }
        
        // Code start
        if (line.startsWith('[CODE:')) {
          inCode = true;
          y += 5;
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(80, 80, 80);
          pdf.text(line.replace('[CODE:', 'Code:').replace(']', ''), margin, y);
          y += 12;
          continue;
        }
        
        // Code end
        if (line === '[/CODE]') {
          inCode = false;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(fontSize);
          y += 8;
          continue;
        }
        
        // Code content
        if (inCode) {
          pdf.setFillColor(245, 245, 245);
          pdf.rect(margin - 5, y - 10, contentWidth + 10, 14, 'F');
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(20, 20, 20);
          pdf.text(line.length > 85 ? line.substring(0, 85) + '...' : line, margin, y);
          y += 12;
          continue;
        }
        
        // Numbered list
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(fontSize);
          pdf.setTextColor(30, 30, 30);
          pdf.text(numMatch[1] + '.', margin, y);
          pdf.setFont('helvetica', 'normal');
          
          const wrapped = pdf.splitTextToSize(numMatch[2], contentWidth - 25);
          wrapped.forEach((chunk, idx) => {
            if (idx > 0) { y += lineHeight; ensureSpace(lineHeight); }
            pdf.text(chunk, margin + 22, y);
          });
          y += lineHeight + 4;
          continue;
        }
        
        // Bullet points (expanded detection)
        const bulletMatch = line.match(/^[•\-\*●○◦◉◆◇▪▫★☆→➤➔►]\s*(.*)$/);
        if (bulletMatch) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(fontSize);
          pdf.setTextColor(30, 30, 30);
          pdf.text('•', margin + 5, y);
          
          const wrapped = pdf.splitTextToSize(bulletMatch[1], contentWidth - 25);
          wrapped.forEach((chunk, idx) => {
            if (idx > 0) { y += lineHeight; ensureSpace(lineHeight); }
            pdf.text(chunk, margin + 22, y);
          });
          y += lineHeight + 4;
          continue;
        }
        
        // Bold text handling
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(fontSize);
        pdf.setTextColor(30, 30, 30);
        
        if (line.includes('**')) {
          // Parse and render with bold
          let clean = '';
          const boldRanges = [];
          let i = 0, inBold = false, boldStart = 0;
          
          while (i < line.length) {
            if (line.substring(i, i + 2) === '**') {
              if (inBold) {
                boldRanges.push({ start: boldStart, end: clean.length });
                inBold = false;
              } else {
                boldStart = clean.length;
                inBold = true;
              }
              i += 2;
            } else {
              clean += line[i];
              i++;
            }
          }
          
          const wrapped = pdf.splitTextToSize(clean, contentWidth);
          let charIdx = 0;
          
          for (const chunk of wrapped) {
            ensureSpace(lineHeight);
            let x = margin;
            
            for (let c = 0; c < chunk.length; c++) {
              const gIdx = charIdx + c;
              const isBold = boldRanges.some(r => gIdx >= r.start && gIdx < r.end);
              pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
              pdf.text(chunk[c], x, y);
              x += pdf.getTextWidth(chunk[c]);
            }
            charIdx += chunk.length;
            y += lineHeight;
          }
          pdf.setFont('helvetica', 'normal');
        } else {
          const wrapped = pdf.splitTextToSize(line, contentWidth);
          wrapped.forEach(chunk => {
            ensureSpace(lineHeight);
            pdf.text(chunk, margin, y);
            y += lineHeight;
          });
        }
        y += 4;
      }
      y += 20;
    }
    
    // Save
    const filename = data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + '.pdf';
    pdf.save(filename);
    console.log('✅ PDF saved:', filename);
    
  } catch (error) {
    console.error('❌ PDF error:', error);
    alert('Error generating PDF: ' + error.message);
  }
}

async function generatePDF(data) {
  let attempts = 0;
  while (!jsPDFInstance && attempts < 30) {
    await wait(100);
    attempts++;
  }
  
  if (!jsPDFInstance) {
    alert('PDF library loading. Please try again.');
    return;
  }
  
  if (isGemini && jsPDFLib) {
    generatePDFInContentScript(data);
  } else {
    window.postMessage({ type: 'GENERATE_PDF', data }, '*');
  }
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

function downloadMarkdown(data) {
  let md = `# ${data.title}\n\n`;
  md += `**Date:** ${data.date} | **Messages:** ${data.stats.total} | **Words:** ${data.stats.words}\n\n---\n\n`;
  data.messages.forEach(msg => {
    md += `## ${msg.role === 'user' ? 'You' : 'Assistant'}\n\n${msg.text}\n\n---\n\n`;
  });
  
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.md`;
  a.click();
}

function downloadHTML(data) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${data.title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:20px;background:#f7f7f8}
.header{text-align:center;margin-bottom:30px;padding-bottom:20px;border-bottom:1px solid #e5e5e5}
.stats{font-size:.9em;color:#666}
.message{margin-bottom:20px;padding:15px;border-radius:8px}
.user{background:#fff;border:1px solid #e5e5e5}
.assistant{background:#f0f0f0}
.role{font-weight:bold;margin-bottom:10px}
.content{line-height:1.6;white-space:pre-wrap}
</style></head><body>
<div class="header"><h1>${data.title}</h1>
<div class="stats">${data.date} • ${data.stats.total} messages • ${data.stats.words} words</div></div>
${data.messages.map(m => `<div class="message ${m.role}">
<div class="role">${m.role === 'user' ? 'You' : 'Assistant'}</div>
<div class="content">${m.text.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
</div>`).join('')}
</body></html>`;
  
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.html`;
  a.click();
}

// ============================================
// UI - FLOATING MENU
// ============================================

function createFloatingMenu() {
  if (document.getElementById('chat-exporter-menu')) return;
  
  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
    display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end'
  });
  
  const menu = document.createElement('div');
  Object.assign(menu.style, {
    display: 'none', flexDirection: 'column', gap: '6px',
    background: 'white', padding: '12px', borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid #e0e0e0'
  });
  
  const mainBtn = document.createElement('button');
  mainBtn.textContent = '📄 Export Chat';
  Object.assign(mainBtn.style, {
    padding: '12px 20px', borderRadius: '25px', border: 'none',
    background: 'linear-gradient(135deg, #10a37f, #0d8a6a)', color: 'white',
    cursor: 'pointer', fontWeight: 'bold', fontSize: '14px',
    boxShadow: '0 4px 15px rgba(16,163,127,0.3)', transition: 'transform 0.2s'
  });
  mainBtn.onmouseover = () => mainBtn.style.transform = 'scale(1.05)';
  mainBtn.onmouseout = () => mainBtn.style.transform = 'scale(1)';
  
  const createItem = (emoji, text, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = `${emoji} ${text}`;
    Object.assign(btn.style, {
      padding: '10px 16px', borderRadius: '8px', border: '1px solid #eee',
      background: 'white', color: '#333', cursor: 'pointer', fontSize: '13px',
      textAlign: 'left', transition: 'background 0.2s'
    });
    btn.onmouseover = () => btn.style.background = '#f5f5f5';
    btn.onmouseout = () => btn.style.background = 'white';
    btn.onclick = async () => {
      mainBtn.textContent = '⏳ Processing...';
      mainBtn.disabled = true;
      try {
        const data = await extractConversation();
        if (data.messages.length === 0) {
          alert('No messages found.');
        } else {
          await onClick(data);
        }
      } catch (e) {
        alert('Export failed: ' + e.message);
      }
      mainBtn.textContent = '📄 Export Chat';
      mainBtn.disabled = false;
      menu.style.display = 'none';
    };
    return btn;
  };
  
  menu.appendChild(createItem('📄', 'PDF', generatePDF));
  menu.appendChild(createItem('📝', 'Markdown', downloadMarkdown));
  menu.appendChild(createItem('🌐', 'HTML', downloadHTML));
  
  mainBtn.onclick = () => {
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  };
  
  container.appendChild(menu);
  container.appendChild(mainBtn);
  
  (document.querySelector('main') || document.body).appendChild(container);
}

// Initialize
const initMenu = () => {
  if (!document.getElementById('chat-exporter-menu')) createFloatingMenu();
};

new MutationObserver(initMenu).observe(document.body, { childList: true, subtree: true });
setTimeout(initMenu, 500);
setTimeout(initMenu, 2000);
setInterval(initMenu, 3000);

// ============================================
// CONTEXT MENU LISTENER
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportConversation') {
    (async () => {
      try {
        const data = await extractConversation();
        if (!data.messages.length) {
          alert('No conversation found.');
          sendResponse({ success: false });
          return;
        }
        if (isGemini) {
          generatePDFInContentScript(data);
        } else {
          window.postMessage({ type: 'GENERATE_PDF', data }, '*');
        }
        sendResponse({ success: true });
      } catch (e) {
        alert('Export failed: ' + e.message);
        sendResponse({ success: false });
      }
    })();
    return true;
  }
});

console.log('✅ AI Chat Exporter loaded for:', isGemini ? 'Gemini' : isChatGPT ? 'ChatGPT' : 'Other');
