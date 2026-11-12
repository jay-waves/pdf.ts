// Many nonblank pages for manual scrollbar integration checks.
export function scrollingFixture({ pageCount = 100, pathCount = 100, annotationsPerPage = 0 } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  const content = '0.2 0.4 0.8 rg ' + Array.from({ length: pathCount }, (_, i) =>
    `${i % 580} ${i % 760} 10 10 re f`).join('\n');
  for (let i = 0; i < pageCount; i++) {
    const number = objects.length + 1;
    kids.push(`${number} 0 R`);
    const annotations = Array.from({ length: annotationsPerPage }, (_, index) => `${number + 2 + index} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${number + 1} 0 R /Annots [${annotations.join(" ")}] >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    for (let index = 0; index < annotationsPerPage; index++) {
      objects.push(`<< /Type /Annot /Subtype /Text /Rect [40 40 60 60] /Contents (note-${i}-${index}) /F 4 >>`);
    }
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
