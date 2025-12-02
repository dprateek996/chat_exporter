(function() {
  const checkJsPDF = setInterval(() => {
    if (window.jspdf && window.jspdf.jsPDF) {
      clearInterval(checkJsPDF);
      window.postMessage({ type: 'JSPDF_READY', jsPDFAvailable: true }, '*');
    }
  }, 100);

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
      const margin = 40;
      const avatarSize = 30;
      const bubblePadding = 15;
      const maxBubbleWidth = 400; // Maximum width for chat bubbles
      const contentWidth = maxBubbleWidth - (bubblePadding * 2);

      let y = margin;

      // --- HEADER ---
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(0);
      pdf.text(data.title, margin, y);
      y += 20;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(100);
      pdf.text(`${data.date} • ${data.stats.total} messages • ${data.stats.words} words`, margin, y);
      y += 20;

      pdf.setDrawColor(220);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 30;

      // --- MESSAGES ---
      for (const msg of data.messages) {
        const isUser = msg.role === 'user';
        const bubbleColor = isUser ? '#dcf8c6' : '#f0f0f0'; // WhatsApp-style colors
        const textColor = '#000000';

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        
        // Replace code block placeholders with actual content
        let displayText = msg.text;
        if (msg.codeBlocks && msg.codeBlocks.length > 0) {
          msg.codeBlocks.forEach(block => {
            displayText = displayText.replace(block.id, `\n[${block.language.toUpperCase()}]\n${block.code}\n[/${block.language.toUpperCase()}]\n`);
          });
        }
        
        // 1. Prepare Text
        const lines = pdf.splitTextToSize(displayText, contentWidth);
        const lineHeight = 14;
        const textBlockHeight = lines.length * lineHeight;
        
        // 2. Calculate Total Height (Text + Images/SVGs)
        let totalHeight = textBlockHeight + (bubblePadding * 2) + 10;
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                if (img.type === 'svg') {
                    const aspectRatio = img.height / img.width;
                    const displayWidth = Math.min(img.width, contentWidth);
                    const displayHeight = displayWidth * aspectRatio;
                    totalHeight += displayHeight + 10;
                } else {
                    totalHeight += 170;
                }
            }
        }

        // 3. Page Break Check
        if (y + totalHeight + avatarSize > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }

        // 4. Calculate Positions
        let avatarX, bubbleX;
        
        if (isUser) {
          // User message: Right side
          bubbleX = pageWidth - margin - maxBubbleWidth;
          avatarX = pageWidth - margin - avatarSize;
        } else {
          // Assistant message: Left side
          bubbleX = margin + avatarSize + 10;
          avatarX = margin;
        }

        // 5. Draw Avatar
        const avatarY = y;
        pdf.setFillColor(isUser ? '#10a37f' : '#8b5cf6'); // Green for user, Purple for AI
        pdf.circle(avatarX + (avatarSize / 2), avatarY + (avatarSize / 2), avatarSize / 2, 'F');
        
        pdf.setTextColor(255);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        const initial = isUser ? 'U' : 'AI';
        const textWidth = pdf.getTextWidth(initial);
        pdf.text(initial, avatarX + (avatarSize / 2) - (textWidth / 2), avatarY + (avatarSize / 2) + 3);

        // 6. Draw Bubble
        pdf.setFillColor(bubbleColor);
        pdf.setDrawColor(bubbleColor);
        pdf.roundedRect(bubbleX, y, maxBubbleWidth, totalHeight, 8, 8, 'F');

        // 7. Draw Text with Code Block Styling
        let currentY = y + bubblePadding + 8;
        let inCodeBlock = false;
        
        for (const line of lines) {
          // Check if line is code block marker
          const isCodeStart = line.match(/^\[([A-Z]+)\]$/);
          const isCodeEnd = line.match(/^\[\/([A-Z]+)\]$/);
          
          if (isCodeStart) {
            inCodeBlock = true;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            pdf.setTextColor(100);
            pdf.text(line, bubbleX + bubblePadding, currentY);
            currentY += lineHeight;
            continue;
          }
          
          if (isCodeEnd) {
            inCodeBlock = false;
            currentY += 5;
            continue;
          }
          
          if (inCodeBlock) {
            // Code line styling
            pdf.setFont('courier', 'normal');
            pdf.setFontSize(9);
            pdf.setFillColor(isUser ? '#c8e6c9' : '#e8e8e8');
            pdf.rect(bubbleX + bubblePadding - 5, currentY - 10, contentWidth + 10, lineHeight, 'F');
            pdf.setTextColor(textColor);
            pdf.text(line, bubbleX + bubblePadding, currentY);
          } else {
            // Normal text
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            pdf.setTextColor(textColor);
            pdf.text(line, bubbleX + bubblePadding, currentY);
          }
          currentY += lineHeight;
        }

        // 8. Draw Images and SVG Diagrams
        if (msg.images && msg.images.length > 0) {
            let imgY = currentY + 10;
            for (const img of msg.images) {
                try {
                    if (img.type === 'svg' || img.src.startsWith('data:image/svg')) {
                        // SVG: Scale to fit width
                        const aspectRatio = img.height / img.width;
                        const displayWidth = Math.min(img.width, contentWidth);
                        const displayHeight = displayWidth * aspectRatio;
                        
                        // Check if we need a page break
                        if (imgY + displayHeight > pageHeight - margin) {
                            pdf.addPage();
                            y = margin;
                            imgY = margin;
                        }
                        
                        pdf.addImage(img.src, 'SVG', bubbleX + bubblePadding, imgY, displayWidth, displayHeight);
                        imgY += displayHeight + 10;
                    } else {
                        // Regular image: Try to embed, fallback to link
                        try {
                            pdf.addImage(img.src, 'JPEG', bubbleX + bubblePadding, imgY, 200, 150);
                            imgY += 160;
                        } catch (e) {
                            // CORS blocked - show link instead
                            pdf.setTextColor(0, 0, 255);
                            pdf.textWithLink('[Image Attachment]', bubbleX + bubblePadding, imgY, { url: img.src });
                            imgY += 20;
                        }
                    }
                } catch (e) {
                    console.warn("Image/SVG embed failed", e);
                }
            }
        }

        y += totalHeight + 25; // Spacing between messages
      }

      const filename = data.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50) + ".pdf";
      pdf.save(filename);
      window.postMessage({ type: 'PDF_GENERATED' }, '*');

    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("Error: " + error.message);
    }
  });
})();
