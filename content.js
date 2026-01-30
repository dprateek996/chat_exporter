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
const isClaude = location.hostname.includes('claude.ai');

// UI patterns to filter out from extraction
const UI_PATTERNS = [
  /^gemini$/i, /^copy$/i, /^share$/i, /^edit$/i, /^listen$/i,
  /^tools$/i, /^recent$/i, /^gems$/i, /^help$/i, /^settings$/i,
  /^new chat$/i, /^pro$/i, /^show thinking/i, /^thinking/i,
  /^add files$/i, /^explore gems$/i, /^more options$/i,
  /^double-check/i, /^report/i, /^invite a friend/i,
  /gemini can make mistakes/i, /^\+$/, /^choose your model/i,
  /^claude$/i, /^retry$/i, /^continue$/i, /^projects$/i
];

// ============================================
// LIBRARY LOADING
// ============================================

(async () => {
  try {
    if (isGemini || isClaude) {
      console.log(`📚 Loading jsPDF for ${isClaude ? 'Claude' : 'Gemini'}...`);
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
 * Also sanitizes for PDF output (jsPDF only supports basic Latin characters)
 */
function cleanText(text, forPDF = false) {
  if (!text) return '';
  
  let cleaned = text;
  
  // Remove zero-width and invisible characters
  cleaned = cleaned
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
    .replace(/[\u2028\u2029]/g, '\n'); // Line/paragraph separators
  
  // Remove private use area characters (icons/symbols from custom fonts)
  cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '');
  
  // Remove garbage/corrupted characters (icon fonts, symbol fonts)
  cleaned = cleaned
    // Pattern: Ø followed by symbols and letters (common icon font garbage)
    .replace(/Ø[=<>]?[A-Za-zÞþßÜÄŸ€Ý]*/g, '')
    // Individual garbage characters from icon/symbol fonts
    .replace(/[֍þãÜÀŸ¢ßØÞ€Ý]/g, '')
    // More icon font patterns
    .replace(/[\uF000-\uFFFF]/g, '') // Supplementary private use area
    .replace(/[\u2700-\u27BF]/g, match => {
      // Dingbats - convert some, remove others
      if (match === '\u2713' || match === '\u2714') return '[v]';
      if (match === '\u2717' || match === '\u2718') return '[x]';
      return '';
    });
  
  // Normalize common Unicode characters to ASCII equivalents
  const unicodeToAscii = {
    // Quotes
    '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
    '\u2039': '<', '\u203A': '>',
    '\u00AB': '"', '\u00BB': '"',
    // Dashes
    '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
    // Spaces
    '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
    // Ellipsis
    '\u2026': '...',
    // Arrows (convert to text)
    '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
    '\u21D2': '=>', '\u21D0': '<=',
    '\u27A4': '->', '\u2794': '->', '\u279C': '->',
    // Math symbols
    '\u00D7': 'x', '\u00F7': '/',
    '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
    '\u221E': 'infinity',
    // Check marks and crosses
    '\u2713': '[v]', '\u2714': '[v]', '\u2715': '[x]', '\u2716': '[x]',
    '\u2717': '[x]', '\u2718': '[x]',
    // Copyright, trademark
    '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
  };
  
  for (const [unicode, ascii] of Object.entries(unicodeToAscii)) {
    cleaned = cleaned.replace(new RegExp(unicode, 'g'), ascii);
  }
  
  // Normalize bullet points to standard ASCII bullet or dash
  const bulletChars = /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA\u25C6\u25C7\u25D8\u25D9\u2605\u2606\u2666\u2756\u27A2\u29BF\u25A0\u25A1\u25AA\u25AB\u2B24\u26AB\u26AA●○◦◉◆◇▪▫★☆►▸◂◀]/g;
  cleaned = cleaned.replace(bulletChars, '-');
  
  if (forPDF) {
    // For PDF: Replace remaining non-ASCII with closest ASCII or remove
    cleaned = cleaned
      // Common accented characters to base letters
      .replace(/[àáâãäå]/gi, match => match.toLowerCase() === match ? 'a' : 'A')
      .replace(/[èéêë]/gi, match => match.toLowerCase() === match ? 'e' : 'E')
      .replace(/[ìíîï]/gi, match => match.toLowerCase() === match ? 'i' : 'I')
      .replace(/[òóôõö]/gi, match => match.toLowerCase() === match ? 'o' : 'O')
      .replace(/[ùúûü]/gi, match => match.toLowerCase() === match ? 'u' : 'U')
      .replace(/[ñ]/gi, match => match.toLowerCase() === match ? 'n' : 'N')
      .replace(/[ç]/gi, match => match.toLowerCase() === match ? 'c' : 'C')
      .replace(/[ß]/g, 'ss')
      .replace(/[æ]/gi, 'ae')
      .replace(/[œ]/gi, 'oe')
      // Remove any remaining non-printable or non-ASCII characters
      .replace(/[^\x20-\x7E\n\t]/g, '');
  }
  
  // Fix spaced-out text (like "H e l l o" -> "Hello")
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6$7$8')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4$5$6')
      .replace(/\b([A-Za-z])\s([A-Za-z])\s([A-Za-z])\s([A-Za-z])\b/g, '$1$2$3$4');
  }
  
  // Clean up multiple spaces and trim
  return cleaned.replace(/  +/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
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
  
  // Scroll to load all content
  for (let i = 0; i < 20; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(150);
  }
  window.scrollTo(0, 0);
  await wait(500);
  
  // Get title
  let title = document.title?.replace(' - Google', '').replace('Gemini', '').trim() || 'Gemini Conversation';
  
  const messages = [];
  
  // Gemini Pro structure: conversation turns are in specific containers
  // Look for the main conversation container
  
  // Method 1: Find all conversation turns by looking for message containers
  // Gemini typically uses data attributes or specific class patterns
  
  // Try to find user query containers and model response containers
  const conversationContainer = document.querySelector('main') || document.body;
  
  // Gemini structures messages in turns - look for turn containers
  // Common patterns: [class*="turn"], [class*="query"], [class*="response"]
  const turnSelectors = [
    '[class*="conversation-turn"]',
    '[class*="query-content"]',
    '[class*="response-container"]',
    '[class*="message-wrapper"]',
    '[class*="chat-message"]'
  ];
  
  let foundTurns = [];
  
  // First, try to find structured turns
  for (const selector of turnSelectors) {
    const elements = conversationContainer.querySelectorAll(selector);
    if (elements.length > 0) {
      foundTurns = Array.from(elements);
      console.log(`Found ${foundTurns.length} turns with selector: ${selector}`);
      break;
    }
  }
  
  // Method 2: If no structured turns, look for alternating user/model patterns
  if (foundTurns.length === 0) {
    // Look for elements that contain substantial text and are direct children of main areas
    const allElements = conversationContainer.querySelectorAll('div[class]');
    const candidates = [];
    
    for (const el of allElements) {
      // Skip sidebar, nav, buttons
      if (el.closest('nav, aside, header, footer, [class*="sidebar"], [class*="drawer"]')) continue;
      if (el.querySelector('input, textarea')) continue;
      
      const text = el.innerText?.trim();
      if (!text || text.length < 20) continue;
      
      // Check if this element has text that's not just from children
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      
      const rect = el.getBoundingClientRect();
      // Must be in main content area (not sidebar)
      if (rect.width < 300) continue;
      
      candidates.push({
        el,
        text,
        top: rect.top + window.scrollY,
        isUserLikely: text.length < 500 && !el.querySelector('pre, code, ul, ol')
      });
    }
    
    // Sort by vertical position
    candidates.sort((a, b) => a.top - b.top);
    
    // Deduplicate - remove elements whose text is contained in another
    const uniqueCandidates = [];
    for (const candidate of candidates) {
      const isDuplicate = uniqueCandidates.some(existing => 
        existing.text.includes(candidate.text) || candidate.text.includes(existing.text)
      );
      if (!isDuplicate && candidate.text.length > 30) {
        uniqueCandidates.push(candidate);
      }
    }
    
    foundTurns = uniqueCandidates.map(c => c.el);
    console.log(`Found ${foundTurns.length} candidate turns via fallback method`);
  }
  
  // Process found turns
  for (let i = 0; i < foundTurns.length; i++) {
    const turn = foundTurns[i];
    let text = turn.innerText?.trim() || '';
    
    if (!text || text.length < 10) continue;
    
    // Clean the text
    text = cleanText(text, false);
    
    // Filter out UI elements
    if (shouldFilterLine(text)) continue;
    
    // Determine if this is user or assistant
    // Heuristics:
    // - User messages are typically shorter
    // - User messages don't have lists, code blocks, headers
    // - Check for specific class names
    let role = 'assistant';
    
    const className = turn.className?.toLowerCase() || '';
    const parentClass = turn.parentElement?.className?.toLowerCase() || '';
    
    if (className.includes('user') || className.includes('query') || className.includes('human') ||
        parentClass.includes('user') || parentClass.includes('query') || parentClass.includes('human')) {
      role = 'user';
    } else if (className.includes('model') || className.includes('response') || className.includes('assistant') ||
               parentClass.includes('model') || parentClass.includes('response') || parentClass.includes('assistant')) {
      role = 'assistant';
    } else {
      // Use heuristics: alternate, with first being user
      // Or check content characteristics
      const hasStructuredContent = turn.querySelector('pre, code, ul, ol, h1, h2, h3');
      const isLong = text.length > 300;
      
      if (hasStructuredContent || isLong) {
        role = 'assistant';
      } else if (messages.length === 0 || messages[messages.length - 1]?.role === 'assistant') {
        role = 'user';
      } else {
        role = 'assistant';
      }
    }
    
    // Extract code blocks if present
    const codeBlocks = [];
    const codeElements = turn.querySelectorAll('pre code, pre');
    codeElements.forEach((codeEl, idx) => {
      const code = codeEl.innerText?.trim();
      if (code && code.length > 10) {
        const langClass = codeEl.className?.match(/language-(\w+)/);
        const lang = langClass ? langClass[1] : 'code';
        const id = `[CODE_${messages.length}_${idx}]`;
        codeBlocks.push({ id, language: lang, code });
        text = text.replace(code, id);
      }
    });
    
    messages.push({
      role,
      text: text.replace(/\n{3,}/g, '\n\n').trim(),
      codeBlocks,
      images: []
    });
  }
  
  // If still no messages, use fallback
  if (messages.length === 0) {
    console.log('Using full fallback extraction');
    const main = document.querySelector('main');
    if (main) {
      const clone = main.cloneNode(true);
      clone.querySelectorAll('nav, aside, [class*="sidebar"], [class*="drawer"], button, input, textarea').forEach(el => el.remove());
      const text = cleanText(clone.innerText || '', false);
      if (text.length > 50) {
        messages.push({
          role: 'assistant',
          text,
          codeBlocks: [],
          images: []
        });
      }
    }
  }
  
  console.log(`📊 Extracted ${messages.length} messages from Gemini`);
  
  return { title, messages };
}

// Legacy function kept for compatibility
function processGeminiText(text) {
  const lines = text.split('\n');
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
    
    line = cleanText(line, false);
    
    // Normalize bullet characters
    line = line.replace(/^[-*]\s+/g, '- ');
    
    if (line) {
      foundContent = true;
      cleanedLines.push(line);
    }
  }
  
  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================
// CLAUDE EXTRACTION  
// ============================================

async function extractClaudeContent() {
  console.log('🔍 Extracting Claude conversation...');
  
  // Scroll to load all content
  for (let i = 0; i < 20; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await wait(150);
  }
  window.scrollTo(0, 0);
  await wait(500);
  
  // Get title
  let title = document.title?.replace(/\s*[-|]\s*Claude/gi, '').replace('Claude', '').trim() || 'Claude Conversation';
  
  const messages = [];
  
  // Claude's DOM structure: look for human and assistant message containers
  // Claude typically separates messages clearly with role indicators
  
  const conversationContainer = document.querySelector('main') || document.body;
  
  // Method 1: Look for message containers with role attributes
  // Claude often uses data-* attributes or specific class patterns
  const messageSelectors = [
    '[data-testid*="message"]',
    '[class*="message-row"]',
    '[class*="human-message"], [class*="assistant-message"]',
    '[class*="user-message"], [class*="ai-message"]',
    'div[class*="Message"]'
  ];
  
  let messageElements = [];
  
  for (const selector of messageSelectors) {
    const elements = conversationContainer.querySelectorAll(selector);
    if (elements.length > 0) {
      messageElements = Array.from(elements);
      console.log(`Found ${messageElements.length} messages with selector: ${selector}`);
      break;
    }
  }
  
  // Method 2: Look for the conversation structure by finding grouped content
  if (messageElements.length === 0) {
    // Claude typically has a consistent structure - look for parent containers
    // that hold both the role indicator and content
    const allDivs = conversationContainer.querySelectorAll('div');
    const candidates = [];
    
    for (const div of allDivs) {
      // Skip sidebar, nav, buttons, inputs
      if (div.closest('nav, aside, header, footer, [class*="sidebar"]')) continue;
      if (div.querySelector('input, textarea')) continue;
      
      const text = div.innerText?.trim();
      if (!text || text.length < 15) continue;
      
      const rect = div.getBoundingClientRect();
      // Must be in main content area
      if (rect.width < 400) continue;
      
      // Check for role indicators in parent or self
      const fullClass = (div.className + ' ' + (div.parentElement?.className || '')).toLowerCase();
      const hasRoleIndicator = fullClass.includes('human') || fullClass.includes('user') || 
                               fullClass.includes('assistant') || fullClass.includes('claude') ||
                               fullClass.includes('message');
      
      if (hasRoleIndicator || text.length > 100) {
        candidates.push({
          el: div,
          text,
          top: rect.top + window.scrollY,
          className: fullClass
        });
      }
    }
    
    // Sort by vertical position
    candidates.sort((a, b) => a.top - b.top);
    
    // Deduplicate - prefer shorter containers (more specific)
    const uniqueCandidates = [];
    const seenTexts = new Set();
    
    for (const candidate of candidates) {
      // Create a signature from first/last 50 chars
      const sig = (candidate.text.slice(0, 50) + candidate.text.slice(-50)).toLowerCase();
      
      // Check if this text is a substring of existing or vice versa
      let isDuplicate = false;
      for (const existing of uniqueCandidates) {
        if (existing.text.includes(candidate.text) || candidate.text.includes(existing.text)) {
          // Keep the more specific (shorter) one if it's substantial
          if (candidate.text.length < existing.text.length && candidate.text.length > 30) {
            existing.text = candidate.text;
            existing.el = candidate.el;
          }
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate && !seenTexts.has(sig) && candidate.text.length > 20) {
        seenTexts.add(sig);
        uniqueCandidates.push(candidate);
      }
    }
    
    messageElements = uniqueCandidates.map(c => c.el);
    console.log(`Found ${messageElements.length} candidate messages via fallback`);
  }
  
  // Process found messages
  for (let i = 0; i < messageElements.length; i++) {
    const msgEl = messageElements[i];
    let text = msgEl.innerText?.trim() || '';
    
    if (!text || text.length < 10) continue;
    
    // Clean the text
    text = cleanText(text, false);
    
    // Filter out pure UI elements
    if (shouldFilterLine(text)) continue;
    if (/^(Copy|Retry|Continue|Edit|Share)$/i.test(text.split('\n')[0])) continue;
    
    // Determine role
    let role = 'assistant';
    
    const className = (msgEl.className || '').toLowerCase();
    const parentClass = (msgEl.parentElement?.className || '').toLowerCase();
    const grandParentClass = (msgEl.parentElement?.parentElement?.className || '').toLowerCase();
    const allClasses = className + ' ' + parentClass + ' ' + grandParentClass;
    
    // Check for explicit role indicators
    if (allClasses.includes('human') || allClasses.includes('user')) {
      role = 'user';
    } else if (allClasses.includes('assistant') || allClasses.includes('claude') || allClasses.includes('ai-')) {
      role = 'assistant';
    } else {
      // Use heuristics
      const hasStructuredContent = msgEl.querySelector('pre, code, ul, ol, h1, h2, h3, table');
      const isLong = text.length > 400;
      const hasMultipleParagraphs = (text.match(/\n\n/g) || []).length >= 2;
      
      if (hasStructuredContent || isLong || hasMultipleParagraphs) {
        role = 'assistant';
      } else if (messages.length === 0 || messages[messages.length - 1]?.role === 'assistant') {
        role = 'user';
      } else {
        role = 'assistant';
      }
    }
    
    // Extract code blocks
    const codeBlocks = [];
    const codeElements = msgEl.querySelectorAll('pre code, pre');
    codeElements.forEach((codeEl, idx) => {
      const code = codeEl.innerText?.trim();
      if (code && code.length > 10) {
        const langMatch = codeEl.className?.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'code';
        const id = `[CODE_${messages.length}_${idx}]`;
        codeBlocks.push({ id, language: lang, code });
        // Replace code in text with placeholder
        text = text.replace(code, id);
      }
    });
    
    messages.push({
      role,
      text: text.replace(/\n{3,}/g, '\n\n').trim(),
      codeBlocks,
      images: []
    });
  }
  
  // Fallback: if no structured messages found, try to split by patterns
  if (messages.length === 0) {
    console.log('Using full fallback extraction for Claude');
    const main = document.querySelector('main');
    if (main) {
      const clone = main.cloneNode(true);
      clone.querySelectorAll('nav, aside, [class*="sidebar"], button, input, textarea, svg').forEach(el => el.remove());
      const text = cleanText(clone.innerText || '', false);
      
      if (text.length > 50) {
        // Try to split by "Human:" and "Assistant:" patterns if present
        const parts = text.split(/(?:^|\n)(?:Human|You|User):\s*/i);
        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i++) {
            const assistantSplit = parts[i].split(/\n(?:Assistant|Claude):\s*/i);
            if (assistantSplit.length >= 2) {
              messages.push({ role: 'user', text: assistantSplit[0].trim(), codeBlocks: [], images: [] });
              messages.push({ role: 'assistant', text: assistantSplit[1].trim(), codeBlocks: [], images: [] });
            } else {
              messages.push({ role: 'user', text: parts[i].trim(), codeBlocks: [], images: [] });
            }
          }
        } else {
          messages.push({ role: 'assistant', text, codeBlocks: [], images: [] });
        }
      }
    }
  }
  
  console.log(`📊 Extracted ${messages.length} messages from Claude`);
  
  return { title, messages };
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
  } else if (isClaude) {
    result = await extractClaudeContent();
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
    let pageNumber = 1;
    
    // Helper: ensure space for content, add new page if needed
    const ensureSpace = (needed = 20) => {
      if (y + needed > pageHeight - margin - 20) {
        addPageFooter();
        pdf.addPage();
        pageNumber++;
        y = margin;
        return true;
      }
      return false;
    };
    
    // Helper: add page footer with page number
    const addPageFooter = () => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(150, 150, 150);
      const pageText = `Page ${pageNumber}`;
      const textWidth = pdf.getTextWidth(pageText);
      pdf.text(pageText, (pageWidth - textWidth) / 2, pageHeight - 25);
    };
    
    // Helper: sanitize text for PDF (ASCII only)
    const sanitizeForPDF = (text) => cleanText(text, true);
    
    // ========== DOCUMENT HEADER ==========
    
    // Title
    const safeTitle = sanitizeForPDF(data.title) || 'Chat Conversation';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(30, 30, 30);
    const titleLines = pdf.splitTextToSize(safeTitle, contentWidth);
    titleLines.forEach(line => {
      pdf.text(line, margin, y);
      y += 26;
    });
    y += 5;
    
    // Metadata line
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    const metaText = `Exported: ${data.date}`;
    pdf.text(metaText, margin, y);
    y += 14;
    
    // Stats line
    const statsText = `${data.stats.total} messages | ${data.stats.words} words | ${data.stats.user || 0} from user | ${data.stats.assistant || 0} from assistant`;
    pdf.text(statsText, margin, y);
    y += 20;
    
    // Decorative separator line
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(1);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 30;
    
    // ========== MESSAGE RENDERING ==========
    
    const lineHeight = 14;
    const paragraphSpacing = 10;
    const sectionSpacing = 20;
    
    for (let msgIdx = 0; msgIdx < data.messages.length; msgIdx++) {
      const msg = data.messages[msgIdx];
      if (!msg.text) continue;
      
      // Get sanitized text
      let text = sanitizeForPDF(msg.text);
      if (!text) continue;
      
      // Replace code placeholders with formatted markers
      if (msg.codeBlocks?.length) {
        msg.codeBlocks.forEach(b => {
          const codeContent = sanitizeForPDF(b.code);
          text = text.replace(b.id, `\n[CODE:${b.language.toUpperCase()}]\n${codeContent}\n[/CODE]\n`);
        });
      }
      
      // Message role header
      ensureSpace(40);
      const roleLabel = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      const roleColor = msg.role === 'user' ? [16, 163, 127] : [139, 92, 246]; // Green for user, purple for AI
      
      pdf.setFillColor(...roleColor);
      pdf.roundedRect(margin, y - 12, 70, 18, 3, 3, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(255, 255, 255);
      pdf.text(roleLabel, margin + 8, y);
      y += 18;
      
      // Process text content
      const lines = text.split('\n');
      let inCode = false;
      let codeLanguage = '';
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let line = lines[lineIdx];
        
        // Empty line = paragraph break
        if (!line.trim()) {
          y += paragraphSpacing;
          continue;
        }
        
        // ---- HEADERS ----
        // H1 style: # Header or ## Header
        const h1Match = line.match(/^#{1,2}\s+(.+)$/);
        if (h1Match) {
          ensureSpace(30);
          y += 8;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(14);
          pdf.setTextColor(30, 30, 30);
          const headerText = sanitizeForPDF(h1Match[1]);
          const headerLines = pdf.splitTextToSize(headerText, contentWidth);
          headerLines.forEach(hl => {
            pdf.text(hl, margin, y);
            y += 18;
          });
          y += 4;
          // Underline for h1
          pdf.setDrawColor(220, 220, 220);
          pdf.line(margin, y - 8, margin + Math.min(pdf.getTextWidth(headerText), contentWidth), y - 8);
          continue;
        }
        
        // H3 style: ### Header
        const h3Match = line.match(/^#{3,}\s+(.+)$/);
        if (h3Match) {
          ensureSpace(25);
          y += 5;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(50, 50, 50);
          const h3Lines = pdf.splitTextToSize(sanitizeForPDF(h3Match[1]), contentWidth);
          h3Lines.forEach(hl => {
            pdf.text(hl, margin, y);
            y += 16;
          });
          continue;
        }
        
        // ---- CODE BLOCKS ----
        if (line.match(/^\[CODE:?([A-Z]*)\]$/i)) {
          inCode = true;
          codeLanguage = line.match(/^\[CODE:?([A-Z]*)\]$/i)?.[1] || 'CODE';
          ensureSpace(30);
          y += 5;
          // Code header bar
          pdf.setFillColor(60, 60, 60);
          pdf.roundedRect(margin, y - 10, contentWidth, 18, 3, 3, 'F');
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(200, 200, 200);
          pdf.text(codeLanguage || 'CODE', margin + 8, y + 2);
          y += 16;
          continue;
        }
        
        if (line.match(/^\[\/CODE\]$/i)) {
          inCode = false;
          y += 10;
          continue;
        }
        
        if (inCode) {
          ensureSpace(14);
          // Code background
          pdf.setFillColor(245, 245, 245);
          pdf.rect(margin, y - 10, contentWidth, 14, 'F');
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(40, 40, 40);
          // Truncate long lines
          const codeLine = line.length > 90 ? line.substring(0, 87) + '...' : line;
          pdf.text(codeLine, margin + 5, y);
          y += 12;
          continue;
        }
        
        // ---- NUMBERED LISTS ----
        const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (numMatch) {
          ensureSpace(lineHeight + 5);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor(50, 50, 50);
          const numLabel = numMatch[1] + '.';
          pdf.text(numLabel, margin, y);
          
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(40, 40, 40);
          const numContent = sanitizeForPDF(numMatch[2]);
          const numLines = pdf.splitTextToSize(numContent, contentWidth - 25);
          numLines.forEach((nl, idx) => {
            if (idx > 0) {
              y += lineHeight;
              ensureSpace(lineHeight);
            }
            pdf.text(nl, margin + 22, y);
          });
          y += lineHeight + 3;
          continue;
        }
        
        // ---- BULLET POINTS ----
        const bulletMatch = line.match(/^[-*]\s+(.+)$/);
        if (bulletMatch) {
          ensureSpace(lineHeight + 5);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(40, 40, 40);
          // Draw bullet dot
          pdf.setFillColor(80, 80, 80);
          pdf.circle(margin + 4, y - 3, 2, 'F');
          
          const bulletContent = sanitizeForPDF(bulletMatch[1]);
          const bulletLines = pdf.splitTextToSize(bulletContent, contentWidth - 20);
          bulletLines.forEach((bl, idx) => {
            if (idx > 0) {
              y += lineHeight;
              ensureSpace(lineHeight);
            }
            pdf.text(bl, margin + 15, y);
          });
          y += lineHeight + 2;
          continue;
        }
        
        // ---- BOLD TEXT HANDLING ----
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.setTextColor(40, 40, 40);
        
        // Check for bold markers **text**
        if (line.includes('**')) {
          const segments = [];
          let remaining = line;
          let isBold = false;
          
          while (remaining.length > 0) {
            const boldIdx = remaining.indexOf('**');
            if (boldIdx === -1) {
              segments.push({ text: remaining, bold: isBold });
              break;
            }
            if (boldIdx > 0) {
              segments.push({ text: remaining.substring(0, boldIdx), bold: isBold });
            }
            isBold = !isBold;
            remaining = remaining.substring(boldIdx + 2);
          }
          
          // Render segments
          const plainText = segments.map(s => s.text).join('');
          const wrapped = pdf.splitTextToSize(plainText, contentWidth);
          
          for (const wrapLine of wrapped) {
            ensureSpace(lineHeight);
            let x = margin;
            let charPos = 0;
            
            for (const seg of segments) {
              pdf.setFont('helvetica', seg.bold ? 'bold' : 'normal');
              for (let c = 0; c < seg.text.length && charPos < wrapLine.length; c++) {
                if (seg.text[c] === wrapLine[charPos]) {
                  pdf.text(wrapLine[charPos], x, y);
                  x += pdf.getTextWidth(wrapLine[charPos]);
                  charPos++;
                }
              }
            }
            y += lineHeight;
          }
          continue;
        }
        
        // ---- REGULAR PARAGRAPH TEXT ----
        ensureSpace(lineHeight);
        const wrapped = pdf.splitTextToSize(line, contentWidth);
        wrapped.forEach(chunk => {
          ensureSpace(lineHeight);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(40, 40, 40);
          pdf.text(chunk, margin, y);
          y += lineHeight;
        });
      }
      
      // Spacing between messages
      y += sectionSpacing;
      
      // Add subtle separator between messages
      if (msgIdx < data.messages.length - 1) {
        ensureSpace(20);
        pdf.setDrawColor(230, 230, 230);
        pdf.setLineWidth(0.5);
        const separatorWidth = 100;
        pdf.line((pageWidth - separatorWidth) / 2, y - 10, (pageWidth + separatorWidth) / 2, y - 10);
      }
    }
    
    // Add footer to last page
    addPageFooter();
    
    // Save the PDF
    const filename = safeTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + '.pdf';
    pdf.save(filename);
    console.log('PDF saved:', filename);
    
  } catch (error) {
    console.error('PDF error:', error);
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
  
  if ((isGemini || isClaude) && jsPDFLib) {
    generatePDFInContentScript(data);
  } else {
    window.postMessage({ type: 'GENERATE_PDF', data }, '*');
  }
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

function downloadMarkdown(data) {
  // Create a properly formatted Markdown document
  let md = '';
  
  // Document title with proper heading
  md += `# ${data.title}\n\n`;
  
  // Metadata section
  md += `> **Exported:** ${data.date}  \n`;
  md += `> **Messages:** ${data.stats.total} (${data.stats.user || 0} from user, ${data.stats.assistant || 0} from assistant)  \n`;
  md += `> **Word Count:** ${data.stats.words}\n\n`;
  
  // Separator
  md += `---\n\n`;
  
  // Process each message
  data.messages.forEach((msg, idx) => {
    const roleEmoji = msg.role === 'user' ? '👤' : '🤖';
    const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
    
    // Message header
    md += `## ${roleEmoji} ${roleLabel}\n\n`;
    
    // Process message content
    let text = msg.text || '';
    
    // Handle code blocks - replace placeholders with proper markdown code blocks
    if (msg.codeBlocks?.length) {
      msg.codeBlocks.forEach(block => {
        text = text.replace(block.id, `\n\`\`\`${block.language}\n${block.code}\n\`\`\`\n`);
      });
    }
    
    // Format the text content
    const lines = text.split('\n');
    const formattedLines = [];
    
    for (const line of lines) {
      let formattedLine = line;
      
      // Preserve existing headers
      if (formattedLine.match(/^#{1,6}\s+/)) {
        formattedLines.push(formattedLine);
        continue;
      }
      
      // Preserve code blocks
      if (formattedLine.match(/^```/) || formattedLine.match(/^\s{4,}/)) {
        formattedLines.push(formattedLine);
        continue;
      }
      
      // Normalize bullet points to markdown format
      formattedLine = formattedLine.replace(/^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA•●○◦◆◇▪▫★☆→➤➔►]\s*/g, '- ');
      
      // Ensure numbered lists have proper formatting
      formattedLine = formattedLine.replace(/^(\d+)\)\s+/, '$1. ');
      
      formattedLines.push(formattedLine);
    }
    
    md += formattedLines.join('\n');
    md += '\n\n';
    
    // Add separator between messages (except after last one)
    if (idx < data.messages.length - 1) {
      md += `---\n\n`;
    }
  });
  
  // Footer
  md += `\n---\n\n`;
  md += `*Exported using AI Chat Exporter*\n`;
  
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadHTML(data) {
  // Create a professionally formatted HTML document
  const escapeHTML = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  // Process message text to HTML with proper formatting
  const formatMessageHTML = (msg) => {
    let text = msg.text || '';
    
    // Handle code blocks
    if (msg.codeBlocks?.length) {
      msg.codeBlocks.forEach(block => {
        const escapedCode = escapeHTML(block.code);
        text = text.replace(block.id, 
          `<div class="code-block"><div class="code-header">${escapeHTML(block.language.toUpperCase())}</div><pre><code>${escapedCode}</code></pre></div>`
        );
      });
    }
    
    // Split into lines and process
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let listType = '';
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Empty line
      if (!line.trim()) {
        if (inList) {
          html += listType === 'ul' ? '</ul>' : '</ol>';
          inList = false;
        }
        html += '<br>';
        continue;
      }
      
      // Headers
      const h1Match = line.match(/^#{1,2}\s+(.+)$/);
      if (h1Match) {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
        html += `<h3>${escapeHTML(h1Match[1])}</h3>`;
        continue;
      }
      
      const h3Match = line.match(/^#{3,}\s+(.+)$/);
      if (h3Match) {
        if (inList) { html += listType === 'ul' ? '</ul>' : '</ol>'; inList = false; }
        html += `<h4>${escapeHTML(h3Match[1])}</h4>`;
        continue;
      }
      
      // Bullet points
      const bulletMatch = line.match(/^[-*\u2022\u25CF\u25CB•●○]\s*(.+)$/);
      if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ul>';
          inList = true;
          listType = 'ul';
        }
        html += `<li>${formatInlineHTML(escapeHTML(bulletMatch[1]))}</li>`;
        continue;
      }
      
      // Numbered list
      const numMatch = line.match(/^(\d+)[.)]\s*(.+)$/);
      if (numMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) html += listType === 'ul' ? '</ul>' : '</ol>';
          html += '<ol>';
          inList = true;
          listType = 'ol';
        }
        html += `<li>${formatInlineHTML(escapeHTML(numMatch[2]))}</li>`;
        continue;
      }
      
      // Regular paragraph
      if (inList) {
        html += listType === 'ul' ? '</ul>' : '</ol>';
        inList = false;
      }
      
      // Check if line already contains HTML (from code block replacement)
      if (line.includes('<div class="code-block">')) {
        html += line;
      } else {
        html += `<p>${formatInlineHTML(escapeHTML(line))}</p>`;
      }
    }
    
    if (inList) {
      html += listType === 'ul' ? '</ul>' : '</ol>';
    }
    
    return html;
  };
  
  // Format inline elements (bold, italic, code)
  const formatInlineHTML = (text) => {
    return text
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // Inline code: `code`
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  };
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(data.title)}</title>
  <style>
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fafafa;
      color: #333;
    }
    
    /* Document Header */
    .document-header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 30px;
      border-bottom: 2px solid #e0e0e0;
    }
    
    .document-header h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0 0 15px 0;
    }
    
    .metadata {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 20px;
      font-size: 14px;
      color: #666;
    }
    
    .metadata-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .metadata-item strong {
      color: #444;
    }
    
    /* Messages */
    .message {
      margin-bottom: 30px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      overflow: hidden;
    }
    
    .message-header {
      padding: 12px 20px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .message.user .message-header {
      background: linear-gradient(135deg, #10a37f, #0d8a6a);
      color: white;
    }
    
    .message.assistant .message-header {
      background: linear-gradient(135deg, #8b5cf6, #7c3aed);
      color: white;
    }
    
    .message-content {
      padding: 20px;
    }
    
    .message-content p {
      margin: 0 0 12px 0;
    }
    
    .message-content p:last-child {
      margin-bottom: 0;
    }
    
    .message-content h3 {
      font-size: 18px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 20px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #eee;
    }
    
    .message-content h3:first-child {
      margin-top: 0;
    }
    
    .message-content h4 {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin: 15px 0 8px 0;
    }
    
    /* Lists */
    .message-content ul,
    .message-content ol {
      margin: 12px 0;
      padding-left: 24px;
    }
    
    .message-content li {
      margin: 6px 0;
    }
    
    /* Code */
    .code-block {
      margin: 15px 0;
      border-radius: 8px;
      overflow: hidden;
      background: #1e1e1e;
    }
    
    .code-header {
      background: #333;
      color: #aaa;
      padding: 8px 12px;
      font-size: 12px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }
    
    .code-block pre {
      margin: 0;
      padding: 15px;
      overflow-x: auto;
    }
    
    .code-block code {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 13px;
      color: #d4d4d4;
      line-height: 1.5;
    }
    
    .inline-code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.9em;
      color: #c7254e;
    }
    
    /* Footer */
    .document-footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 12px;
      color: #999;
    }
    
    /* Print styles */
    @media print {
      body {
        background: white;
        padding: 20px;
      }
      
      .message {
        box-shadow: none;
        border: 1px solid #ddd;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="document-header">
    <h1>${escapeHTML(data.title)}</h1>
    <div class="metadata">
      <div class="metadata-item">
        <span>📅</span>
        <span>${escapeHTML(data.date)}</span>
      </div>
      <div class="metadata-item">
        <span>💬</span>
        <strong>${data.stats.total}</strong>
        <span>messages</span>
      </div>
      <div class="metadata-item">
        <span>📝</span>
        <strong>${data.stats.words}</strong>
        <span>words</span>
      </div>
    </div>
  </div>
  
  <div class="messages">
${data.messages.map(msg => `    <div class="message ${msg.role}">
      <div class="message-header">
        <span>${msg.role === 'user' ? '👤' : '🤖'}</span>
        <span>${msg.role === 'user' ? 'You' : 'Assistant'}</span>
      </div>
      <div class="message-content">
        ${formatMessageHTML(msg)}
      </div>
    </div>`).join('\n')}
  </div>
  
  <div class="document-footer">
    Exported using AI Chat Exporter
  </div>
</body>
</html>`;
  
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================
// UI - FLOATING MENU
// ============================================

function createFloatingMenu() {
  if (document.getElementById('chat-exporter-menu')) return;
  
  const container = document.createElement('div');
  container.id = 'chat-exporter-menu';
  Object.assign(container.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '999999',
    display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end'
  });
  
  const menu = document.createElement('div');
  Object.assign(menu.style, {
    display: 'none', flexDirection: 'column', gap: '8px',
    background: '#2a2a2a', padding: '14px', borderRadius: '14px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #3a3a3a',
    backdropFilter: 'blur(10px)'
  });
  
  const mainBtn = document.createElement('button');
  mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
  Object.assign(mainBtn.style, {
    padding: '11px 18px', borderRadius: '10px', border: '1px solid #3a3a3a',
    background: '#2a2a2a', color: '#e5e5e5',
    cursor: 'pointer', fontWeight: '500', fontSize: '13px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  });
  mainBtn.onmouseover = () => {
    mainBtn.style.background = '#333';
    mainBtn.style.transform = 'translateY(-2px)';
    mainBtn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
  };
  mainBtn.onmouseout = () => {
    mainBtn.style.background = '#2a2a2a';
    mainBtn.style.transform = 'translateY(0)';
    mainBtn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
  };
  
  const createItem = (emoji, text, onClick) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span style="margin-right:8px;">${emoji}</span>${text}`;
    Object.assign(btn.style, {
      padding: '10px 14px', borderRadius: '8px', border: '1px solid #3a3a3a',
      background: '#222', color: '#e5e5e5', cursor: 'pointer', fontSize: '13px',
      textAlign: 'left', transition: 'all 0.2s', display: 'flex', alignItems: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '400', minWidth: '140px'
    });
    btn.onmouseover = () => {
      btn.style.background = '#333';
      btn.style.borderColor = '#4a4a4a';
    };
    btn.onmouseout = () => {
      btn.style.background = '#222';
      btn.style.borderColor = '#3a3a3a';
    };
    btn.onclick = async () => {
      mainBtn.innerHTML = '<span style="margin-right:6px;">⏳</span>Processing...';
      mainBtn.disabled = true;
      mainBtn.style.opacity = '0.6';
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
      mainBtn.innerHTML = '<span style="margin-right:6px;">📄</span>Export';
      mainBtn.disabled = false;
      mainBtn.style.opacity = '1';
      menu.style.display = 'none';
    };
    return btn;
  };
  
  menu.appendChild(createItem('📄', 'PDF', generatePDF));
  menu.appendChild(createItem('📝', 'Markdown', downloadMarkdown));
  menu.appendChild(createItem('🌐', 'HTML', downloadHTML));
  
  mainBtn.onclick = () => {
    const isVisible = menu.style.display === 'flex';
    menu.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
      menu.style.animation = 'slideUp 0.2s ease-out';
    }
  };
  
  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
  
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
        if (isGemini || isClaude) {
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

console.log('✅ ChatArchive loaded for:', isGemini ? 'Gemini' : isClaude ? 'Claude' : isChatGPT ? 'ChatGPT' : 'Other');
