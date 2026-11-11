/** Two-page PDF with nested/direct/action bookmarks, searchable text and locked notes. */
export function viewerFeaturesFixture({ outline = true } = {}) {
  const stream = text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${outline ? '/Outlines 8 0 R' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [13 0 R 14 0 R] >>',
    stream('BT /F1 18 Tf 50 700 Td (API migration alpha alpha) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('BT /F1 18 Tf 50 700 Td (API migration beta alpha) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Outlines /First 9 0 R /Last 12 0 R /Count 4 >>',
    '<< /Title (Chapter One) /Parent 8 0 R /Dest [3 0 R /Fit] /Next 10 0 R /First 11 0 R /Last 11 0 R /Count 1 >>',
    '<< /Title (Chapter Two) /Parent 8 0 R /A << /S /GoTo /D [5 0 R /XYZ 0 792 1.5] >> /Prev 9 0 R /Next 12 0 R >>',
    '<< /Title (Nested Section) /Parent 9 0 R /Dest [3 0 R /XYZ 0 720 null] >>',
    '<< /Title (Reference Website) /Parent 8 0 R /A << /S /URI /URI (https://example.com/reference) >> /Prev 10 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [40 500 60 520] /Contents (Editable note) /F 4 /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [100 500 120 520] /Contents (Locked note) /F 644 /P 3 0 R >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
