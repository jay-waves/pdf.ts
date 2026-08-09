export function downloadPdf(data: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
