export function fixture({ secondPage = false, notes = false, content = '', fontName = 'Helvetica' } = {}) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R] /Resources << /Font << /Helv 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (SharedName) /V (initial) /Rect [50 600 250 630] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) >>',
    '<< /Fields [5 0 R] /DR << /Font << /Helv 7 0 R >> >> /DA (/Helv 12 Tf 0 g) >>',
    `<< /Type /Font /Subtype /Type1 /BaseFont /${fontName} >>`,
  ];
  if (notes) {
    objects[2] = objects[2].replace('/Annots [5 0 R]', '/Annots [5 0 R 8 0 R 9 0 R]');
    objects.push('<< /Type /Annot /Subtype /Text /Rect [40 500 60 520] /Contents (original note) /F 4 >>');
    objects.push('<< /Type /Annot /Subtype /Text /Rect [80 500 100 520] /Contents (delete this note) /F 4 >>');
  }
  if (secondPage) {
    objects[1] = '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>');
  }
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
