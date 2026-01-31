(function() {
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
    }
  }, 100);

  /**
   * Fetch blob URL from page context (blobs are context-specific)
   */
  async function fetchBlobAsBase64(blobUrl) {
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Blob fetch failed:', e);
      return null;
    }
  }

  /**
   * Convert image element to base64 in page context
   */
  function imageElementToBase64(img) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const w = img.naturalWidth || img.width || 300;
      const h = img.naturalHeight || img.height || 200;
      const maxDim = 800;
      let finalW = w, finalH = h;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        finalW = Math.floor(w * ratio);
        finalH = Math.floor(h * ratio);
      }
      canvas.width = finalW;
      canvas.height = finalH;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, finalW, finalH);
      ctx.drawImage(img, 0, 0, finalW, finalH);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn('Canvas conversion failed:', e);
      return null;
    }
  }

  // Handle image fetch requests from content script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    if (event.data.type === 'FETCH_BLOB_IMAGE') {
      const { blobUrl, requestId } = event.data;
      let base64 = null;
      
      // Try fetching the blob
      if (blobUrl.startsWith('blob:')) {
        base64 = await fetchBlobAsBase64(blobUrl);
      }
      
      // If that fails, try finding and capturing the img element
      if (!base64) {
        const img = document.querySelector(`img[src="${blobUrl}"]`);
        if (img && img.complete && img.naturalWidth > 0) {
          base64 = imageElementToBase64(img);
        }
      }
      
      window.postMessage({ 
        type: 'BLOB_IMAGE_RESULT', 
        requestId, 
        base64 
      }, '*');
      return;
    }
  });

  /**
   * Sanitize text for PDF output - jsPDF only supports basic Latin characters
   */
  function sanitizeForPDF(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remove zero-width and invisible characters
    cleaned = cleaned
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u200E\u200F]/g, '')
      .replace(/[\u2028\u2029]/g, '\n');
    
    // Remove private use area characters (icons/symbols)
    cleaned = cleaned.replace(/[\uE000-\uF8FF]/g, '');
    
    // Remove garbage icon font patterns like Ø=Ý
    cleaned = cleaned
      .replace(/Ø[=<>]?[A-Za-zÞþßÜÄŸ€Ý]*/g, '')
      .replace(/[֍þãÜÀŸ¢ßØÞ€Ý]/g, '')
      .replace(/[\uF000-\uFFFF]/g, '');
    
    // Normalize Unicode to ASCII
    const unicodeToAscii = {
      '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
      '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
      '\u2039': '<', '\u203A': '>',
      '\u00AB': '"', '\u00BB': '"',
      '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
      '\u00A0': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ',
      '\u2026': '...',
      '\u2192': '->', '\u2190': '<-', '\u2194': '<->',
      '\u21D2': '=>', '\u21D0': '<=',
      '\u27A4': '->', '\u2794': '->', '\u279C': '->',
      '\u00D7': 'x', '\u00F7': '/',
      '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
      '\u2713': '[v]', '\u2714': '[v]', '\u2715': '[x]', '\u2716': '[x]',
      '\u00A9': '(c)', '\u00AE': '(R)', '\u2122': '(TM)',
    };
    
    for (const [unicode, ascii] of Object.entries(unicodeToAscii)) {
      cleaned = cleaned.replace(new RegExp(unicode, 'g'), ascii);
    }
    
    // Normalize bullet points to dash
    const bulletChars = /[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\u25CB\u25B6\u25BA\u25C6\u25C7\u2605\u2606\u2666\u27A2●○◦◆◇▪▫★☆→➤►]/g;
    cleaned = cleaned.replace(bulletChars, '-');
    
    // Replace accented characters with base letters
    cleaned = cleaned
      .replace(/[\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5]/gi, 'a')
      .replace(/[\u00e8\u00e9\u00ea\u00eb]/gi, 'e')
      .replace(/[\u00ec\u00ed\u00ee\u00ef]/gi, 'i')
      .replace(/[\u00f2\u00f3\u00f4\u00f5\u00f6]/gi, 'o')
      .replace(/[\u00f9\u00fa\u00fb\u00fc]/gi, 'u')
      .replace(/[\u00f1]/gi, 'n')
      .replace(/[\u00e7]/gi, 'c')
      .replace(/[\u00df]/g, 'ss')
      .replace(/[\u00e6]/gi, 'ae')
      .replace(/[\u0153]/gi, 'oe');
    
    // Remove any remaining non-printable or non-ASCII
    cleaned = cleaned.replace(/[^\x20-\x7E\n\t]/g, '');
    
    return cleaned.replace(/  +/g, ' ').trim();
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data.type !== 'GENERATE_PDF') return;

    const data = event.data.data;
    const { jsPDF } = window.jspdf || window;

    if (!jsPDF) {
      alert("jsPDF not available.");
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginLeft = 55;
      const marginRight = 55;
      const marginTop = 60;
      const marginBottom = 60;
      const contentWidth = pageWidth - marginLeft - marginRight;
      let y = marginTop;
      let pageNumber = 1;

      // Professional color palette
      const colors = {
        primary: [41, 98, 255],
        userBadge: [16, 185, 129],
        assistantBadge: [139, 92, 246],
        heading1: [17, 24, 39],
        heading2: [31, 41, 55],
        bodyText: [55, 65, 81],
        lightText: [107, 114, 128],
        codeBg: [243, 244, 246],
        codeHeader: [55, 65, 81],
        border: [209, 213, 219],
        accent: [99, 102, 241],
      };

      // Helper: ensure space, add new page if needed
      const ensureSpace = (needed = 20) => {
        if (y + needed > pageHeight - marginBottom) {
          addPageFooter();
          pdf.addPage();
          pageNumber++;
          y = marginTop;
          addPageHeader();
          return true;
        }
        return false;
      };

      const addPageHeader = () => {
        if (pageNumber > 1) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(...colors.lightText);
          const headerTitle = sanitizeForPDF(data.title).substring(0, 60);
          pdf.text(headerTitle, marginLeft, 35);
          pdf.setDrawColor(...colors.border);
          pdf.setLineWidth(0.5);
          pdf.line(marginLeft, 45, pageWidth - marginRight, 45);
          y = marginTop + 10;
        }
      };

      // Helper: add page footer
      const addPageFooter = () => {
        pdf.setDrawColor(...colors.border);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft, pageHeight - 45, pageWidth - marginRight, pageHeight - 45);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(...colors.lightText);
        pdf.text(`${pageNumber}`, pageWidth / 2 - 5, pageHeight - 30);
        pdf.setFontSize(7);
        pdf.text('ChatGPT Export', pageWidth - marginRight - 55, pageHeight - 30);
      };

      // ========== COVER PAGE ==========
      
      // Top accent bar
      pdf.setFillColor(...colors.primary);
      pdf.rect(0, 0, pageWidth, 8, 'F');
      
      y = 80;
      
      const safeTitle = sanitizeForPDF(data.title) || 'ChatGPT Conversation';
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(26);
      pdf.setTextColor(...colors.heading1);
      const titleLines = pdf.splitTextToSize(safeTitle, contentWidth);
      titleLines.forEach(line => {
        pdf.text(line, marginLeft, y);
        y += 32;
      });
      y += 10;

      // Platform subtitle
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.setTextColor(...colors.accent);
      pdf.text('OpenAI ChatGPT Conversation Export', marginLeft, y);
      y += 30;

      // Metadata box
      pdf.setFillColor(249, 250, 251);
      pdf.setDrawColor(...colors.border);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(marginLeft, y, contentWidth, 70, 4, 4, 'FD');
      
      y += 20;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...colors.lightText);
      pdf.text('EXPORT DATE', marginLeft + 15, y);
      pdf.text('MESSAGES', marginLeft + 150, y);
      pdf.text('WORD COUNT', marginLeft + 280, y);
      
      y += 15;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(...colors.heading2);
      pdf.text(data.date, marginLeft + 15, y);
      pdf.text(`${data.stats.total} total`, marginLeft + 150, y);
      pdf.text(`${data.stats.words} words`, marginLeft + 280, y);
      
      y += 15;
      pdf.setFontSize(9);
      pdf.setTextColor(...colors.lightText);
      pdf.text(`${data.stats.user || 0} from user, ${data.stats.assistant || 0} from assistant`, marginLeft + 150, y);
      
      y += 45;

      // Separator
      pdf.setDrawColor(...colors.border);
      pdf.setLineWidth(1);
      pdf.line(marginLeft, y, pageWidth - marginRight, y);
      y += 35;

      // ========== TABLE OF CONTENTS (for long conversations) ==========
      if (data.messages.length > 6) {
        ensureSpace(80);
        
        // TOC Header
        pdf.setFillColor(...colors.primary);
        pdf.rect(marginLeft, y - 14, 4, 20, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...colors.heading1);
        pdf.text('Conversation Overview', marginLeft + 12, y);
        y += 25;
        
        // List first few exchanges as overview
        const maxPreview = Math.min(data.messages.length, 10);
        for (let i = 0; i < maxPreview; i++) {
          const msg = data.messages[i];
          if (!msg.text) continue;
          
          ensureSpace(20);
          
          // Role indicator dot
          const dotColor = msg.role === 'user' ? colors.userBadge : colors.assistantBadge;
          pdf.setFillColor(...dotColor);
          pdf.circle(marginLeft + 8, y - 3, 4, 'F');
          
          // Message preview (first 60 chars)
          pdf.setFont('helvetica', msg.role === 'user' ? 'bold' : 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(...colors.bodyText);
          const preview = sanitizeForPDF(msg.text).substring(0, 70).replace(/\n/g, ' ');
          pdf.text(`${i + 1}. ${preview}${msg.text.length > 70 ? '...' : ''}`, marginLeft + 18, y);
          y += 16;
        }
        
        if (data.messages.length > 10) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(9);
          pdf.setTextColor(...colors.lightText);
          pdf.text(`... and ${data.messages.length - 10} more messages`, marginLeft + 18, y);
          y += 16;
        }
        
        y += 20;
        
        // Separator after TOC
        pdf.setDrawColor(...colors.border);
        pdf.setLineWidth(0.5);
        pdf.line(marginLeft + 30, y, pageWidth - marginRight - 30, y);
        y += 30;
      }

      // ========== MESSAGES ==========

      for (let msgIdx = 0; msgIdx < data.messages.length; msgIdx++) {
        const msg = data.messages[msgIdx];
        if (!msg.text) continue;

        // Sanitize text
        let text = sanitizeForPDF(msg.text);
        if (!text) continue;

        // Handle code blocks
        if (msg.codeBlocks && msg.codeBlocks.length > 0) {
          msg.codeBlocks.forEach(block => {
            const codeContent = sanitizeForPDF(block.code);
            text = text.replace(block.id, `\n<<<CODE:${block.language.toUpperCase()}>>>\n${codeContent}\n<<</CODE>>>\n`);
          });
        }

        // ---- MESSAGE HEADER ----
        ensureSpace(50);
        
        // Message number
        pdf.setFillColor(249, 250, 251);
        pdf.setDrawColor(...colors.border);
        pdf.roundedRect(marginLeft, y - 12, 25, 18, 3, 3, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(...colors.lightText);
        const msgNum = String(msgIdx + 1);
        pdf.text(msgNum, marginLeft + 12 - pdf.getTextWidth(msgNum)/2, y + 1);
        
        // Role badge
        const roleLabel = msg.role === 'user' ? 'YOU' : 'ASSISTANT';
        const roleColor = msg.role === 'user' ? colors.userBadge : colors.assistantBadge;
        
        pdf.setFillColor(...roleColor);
        pdf.roundedRect(marginLeft + 30, y - 12, msg.role === 'user' ? 35 : 70, 18, 3, 3, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(255, 255, 255);
        pdf.text(roleLabel, marginLeft + 36, y + 1);
        y += 20;

        // Process content
        const lines = text.split('\n');
        let inCode = false;
        let codeLanguage = '';
        let codeLineNumber = 1;
        let tableRows = [];
        
        // Helper to render table
        const renderTable = () => {
          if (tableRows.length === 0) return;
          const numCols = Math.max(...tableRows.map(r => r.length));
          const colWidth = (contentWidth - 10) / numCols;
          const rowHeight = 22;
          const headerRowHeight = 26;
          const cellPadding = 6;
          
          ensureSpace(headerRowHeight + (tableRows.length - 1) * rowHeight + 20);
          y += 10;
          
          for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
            const row = tableRows[rowIdx];
            const isHeader = rowIdx === 0;
            const currentRowHeight = isHeader ? headerRowHeight : rowHeight;
            
            if (isHeader) {
              pdf.setFillColor(...colors.primary);
            } else {
              pdf.setFillColor(rowIdx % 2 === 0 ? 255 : 249, rowIdx % 2 === 0 ? 255 : 250, rowIdx % 2 === 0 ? 255 : 251);
            }
            pdf.rect(marginLeft, y, contentWidth, currentRowHeight, 'F');
            pdf.setDrawColor(...colors.border);
            pdf.setLineWidth(0.5);
            pdf.rect(marginLeft, y, contentWidth, currentRowHeight, 'S');
            
            for (let colIdx = 1; colIdx < numCols; colIdx++) {
              pdf.line(marginLeft + colIdx * colWidth, y, marginLeft + colIdx * colWidth, y + currentRowHeight);
            }
            
            for (let colIdx = 0; colIdx < row.length; colIdx++) {
              const cellText = sanitizeForPDF(row[colIdx] || '').trim();
              const cellX = marginLeft + colIdx * colWidth + cellPadding;
              const cellY = y + (currentRowHeight / 2) + 4;
              
              if (isHeader) {
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(9);
                pdf.setTextColor(255, 255, 255);
              } else {
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(9);
                pdf.setTextColor(...colors.bodyText);
              }
              
              let displayText = cellText;
              const maxCellWidth = colWidth - cellPadding * 2;
              while (pdf.getTextWidth(displayText) > maxCellWidth && displayText.length > 3) {
                displayText = displayText.slice(0, -4) + '...';
              }
              pdf.text(displayText, cellX, cellY);
            }
            y += currentRowHeight;
          }
          y += 15;
          tableRows = [];
        };

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];

          // Empty line
          if (!line.trim()) {
            if (tableRows.length > 0) renderTable();
            y += 10;
            continue;
          }
          
          // ---- TABLE DETECTION ----
          const isTableRow = line.includes('|') && (line.match(/\|/g) || []).length >= 2;
          const isTableSeparator = /^\s*\|?[\s\-:]+\|[\s\-:|]+\|?\s*$/.test(line);
          
          if (isTableRow && !isTableSeparator) {
            const cells = line.split('|').map(cell => cell.trim()).filter((cell, idx, arr) => {
              return !(idx === 0 && cell === '') && !(idx === arr.length - 1 && cell === '');
            });
            if (cells.length > 0) tableRows.push(cells);
            continue;
          }
          if (isTableSeparator) continue;
          if (tableRows.length > 0) renderTable();
          
          // ---- BOLD TITLE DETECTION ----
          const colonTitleMatch = line.match(/^([A-Z][^:]{2,60}):\s*$/);
          if (colonTitleMatch) {
            ensureSpace(28);
            y += 8;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.setTextColor(...colors.heading1);
            pdf.text(sanitizeForPDF(colonTitleMatch[1]), marginLeft, y);
            y += 20;
            continue;
          }

          // H1/H2 Headers
          const h1Match = line.match(/^#{1,2}\s+(.+)$/);
          if (h1Match) {
            ensureSpace(40);
            y += 15;
            pdf.setFillColor(...colors.primary);
            pdf.rect(marginLeft, y - 14, 4, 20, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(...colors.heading1);
            const headerLines = pdf.splitTextToSize(h1Match[1], contentWidth - 20);
            headerLines.forEach(hl => {
              ensureSpace(22);
              pdf.text(hl, marginLeft + 12, y);
              y += 22;
            });
            y += 10;
            continue;
          }

          // H3+ Headers
          const h3Match = line.match(/^#{3,}\s+(.+)$/);
          if (h3Match) {
            ensureSpace(32);
            y += 10;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            pdf.setTextColor(...colors.heading2);
            const h3Lines = pdf.splitTextToSize(h3Match[1], contentWidth);
            h3Lines.forEach(hl => {
              ensureSpace(18);
              pdf.text(hl, marginLeft, y);
              y += 18;
            });
            y += 6;
            continue;
          }

          // Code block start
          if (line.match(/^<<<CODE:?([A-Z]*)>>>$/i)) {
            inCode = true;
            codeLineNumber = 1;
            codeLanguage = line.match(/^<<<CODE:?([A-Z]*)>>>$/i)?.[1] || 'CODE';
            ensureSpace(40);
            y += 10;
            
            // Code header bar with gradient-like effect
            pdf.setFillColor(45, 55, 72);
            pdf.roundedRect(marginLeft, y - 12, contentWidth, 24, 4, 4, 'F');
            
            // Language badge
            pdf.setFillColor(99, 102, 241);
            pdf.roundedRect(marginLeft + 8, y - 8, 60, 16, 3, 3, 'F');
            pdf.setFont('courier', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(255, 255, 255);
            pdf.text(codeLanguage, marginLeft + 12, y + 3);
            
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(7);
            pdf.setTextColor(160, 170, 180);
            pdf.text('CODE BLOCK', pageWidth - marginRight - 55, y + 3);
            y += 20;
            continue;
          }

          // Code block end
          if (line.match(/^<<<\/CODE>>>$/i)) {
            inCode = false;
            codeLineNumber = 1;
            pdf.setFillColor(...colors.codeBg);
            pdf.roundedRect(marginLeft, y - 8, contentWidth, 8, 0, 0, 'F');
            pdf.setDrawColor(...colors.border);
            pdf.setLineWidth(1);
            pdf.line(marginLeft, y, pageWidth - marginRight, y);
            y += 15;
            continue;
          }

          // Code content
          if (inCode) {
            ensureSpace(14);
            
            // Alternating background
            const bgColor = codeLineNumber % 2 === 0 ? [248, 249, 250] : [243, 244, 246];
            pdf.setFillColor(...bgColor);
            pdf.rect(marginLeft, y - 10, contentWidth, 14, 'F');
            
            // Line number gutter
            pdf.setFillColor(233, 236, 239);
            pdf.rect(marginLeft, y - 10, 28, 14, 'F');
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(7);
            pdf.setTextColor(150, 160, 170);
            const lineNumStr = String(codeLineNumber).padStart(3, ' ');
            pdf.text(lineNumStr, marginLeft + 4, y);
            
            // Code content
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(45, 55, 72);
            const codeLine = line.length > 80 ? line.substring(0, 77) + '...' : line;
            pdf.text(codeLine, marginLeft + 32, y);
            
            codeLineNumber++;
            y += 14;
            continue;
          }

          // Numbered list
          const numMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
          if (numMatch) {
            ensureSpace(18);
            pdf.setFillColor(...colors.primary);
            pdf.circle(marginLeft + 8, y - 3, 8, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(255, 255, 255);
            const num = numMatch[1];
            pdf.text(num, marginLeft + 8 - pdf.getTextWidth(num)/2, y);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(...colors.bodyText);
            const numLines = pdf.splitTextToSize(numMatch[2], contentWidth - 30);
            numLines.forEach((nl, idx) => {
              if (idx > 0) ensureSpace(14);
              pdf.text(nl, marginLeft + 22, y + (idx * 14));
            });
            y += numLines.length * 14 + 4;
            continue;
          }

          // Bullet points
          const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
          if (bulletMatch) {
            ensureSpace(16);
            pdf.setFillColor(...colors.primary);
            pdf.circle(marginLeft + 6, y - 3, 3, 'F');
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(...colors.bodyText);
            const bulletLines = pdf.splitTextToSize(bulletMatch[1], contentWidth - 25);
            bulletLines.forEach((bl, idx) => {
              if (idx > 0) ensureSpace(14);
              pdf.text(bl, marginLeft + 18, y + (idx * 14));
            });
            y += bulletLines.length * 14 + 3;
            continue;
          }

          // Regular text with bold support
          ensureSpace(16);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.setTextColor(...colors.bodyText);
          const wrapped = pdf.splitTextToSize(line, contentWidth);
          wrapped.forEach(chunk => {
            ensureSpace(16);
            pdf.text(chunk, marginLeft, y);
            y += 16;
          });
        }
        
        // Render any remaining table
        if (tableRows.length > 0) renderTable();

        // Handle images
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            try {
              // Try to embed actual image if base64 is available
              if (img.base64) {
                let imgWidth = img.width || 300;
                let imgHeight = img.height || 200;
                
                const maxWidth = Math.min(contentWidth - 20, 400);
                const maxHeight = 300;
                
                if (imgWidth > maxWidth) {
                  const ratio = maxWidth / imgWidth;
                  imgWidth = maxWidth;
                  imgHeight = imgHeight * ratio;
                }
                if (imgHeight > maxHeight) {
                  const ratio = maxHeight / imgHeight;
                  imgHeight = maxHeight;
                  imgWidth = imgWidth * ratio;
                }
                
                ensureSpace(imgHeight + 45);
                y += 8;
                
                pdf.setFillColor(249, 250, 251);
                pdf.setDrawColor(...colors.border);
                pdf.setLineWidth(1);
                pdf.roundedRect(marginLeft, y, contentWidth, imgHeight + 35, 6, 6, 'FD');
                
                try {
                  const imgX = marginLeft + (contentWidth - imgWidth) / 2;
                  pdf.addImage(img.base64, 'JPEG', imgX, y + 8, imgWidth, imgHeight);
                  
                  // Caption
                  pdf.setFont('helvetica', 'italic');
                  pdf.setFontSize(9);
                  pdf.setTextColor(...colors.lightText);
                  const caption = sanitizeForPDF(img.alt) || 'Image';
                  const captionX = marginLeft + (contentWidth - pdf.getTextWidth(caption)) / 2;
                  pdf.text(caption, captionX, y + imgHeight + 25);
                  
                  y += imgHeight + 42;
                } catch (embedErr) {
                  console.warn('Failed to embed image:', embedErr);
                }
              } else {
                // Show improved placeholder
                ensureSpace(70);
                y += 5;
                
                // Warm yellow placeholder box
                pdf.setFillColor(254, 243, 199);
                pdf.setDrawColor(251, 191, 36);
                pdf.setLineWidth(1);
                pdf.roundedRect(marginLeft, y, contentWidth, 60, 6, 6, 'FD');
                
                // Camera icon box
                pdf.setFillColor(251, 191, 36);
                pdf.roundedRect(marginLeft + 15, y + 12, 35, 36, 4, 4, 'F');
                
                // Camera lens
                pdf.setFillColor(255, 255, 255);
                pdf.circle(marginLeft + 32, y + 25, 6, 'F');
                pdf.setFillColor(251, 191, 36);
                pdf.circle(marginLeft + 32, y + 25, 3, 'F');
                pdf.setFillColor(255, 255, 255);
                pdf.roundedRect(marginLeft + 20, y + 35, 25, 8, 2, 2, 'F');
                
                // Text
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(10);
                pdf.setTextColor(146, 64, 14);
                pdf.text(`Image: ${sanitizeForPDF(img.alt) || 'Attachment'}`, marginLeft + 60, y + 22);
                
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.setTextColor(180, 83, 9);
                pdf.text('Image was uploaded to the conversation', marginLeft + 60, y + 35);
                pdf.text('(cannot be embedded due to security restrictions)', marginLeft + 60, y + 46);
                
                y += 68;
              }
            } catch (e) {
              console.warn("Image embed failed", e);
            }
          }
        }

        // Message separator
        y += 18;
        if (msgIdx < data.messages.length - 1) {
          ensureSpace(30);
          pdf.setDrawColor(...colors.border);
          pdf.setLineWidth(0.5);
          pdf.line(marginLeft + 50, y, pageWidth - marginRight - 50, y);
          y += 30;
        }
      }

      // Footer on last page
      addPageFooter();

      // Save
      const filename = safeTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + ".pdf";
      pdf.save(filename);
      window.postMessage({ type: 'PDF_GENERATED' }, '*');

    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("Error generating PDF: " + error.message);
    }
  });
})();
