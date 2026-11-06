/** Owned, deterministic PDFs: regression tests never require cached hotel brochures. */
export function brochureFixture({pages=25,landscape=true}={}) {
    const width=landscape?960:612,height=landscape?600:792
    const objects=['','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    const pageIds=[]
    for(let index=0;index<pages;index++) {
        const page=objects.length+1,content=page+1
        pageIds.push(page)
        const commands=[
            '0.96 0.97 0.99 rg',`0 0 ${width} ${height} re f`,
            '0.12 0.22 0.45 rg',`0 ${height-145} ${width} 145 re f`,
            '1 1 1 rg',`BT /F1 28 Tf 40 ${height-65} Td (FLEX project review - page ${index+1}) Tj ET`,
            `BT /F1 14 Tf 40 ${height-100} Td (Owned regression fixture for document viewing and annotations.) Tj ET`,
        ]
        for(let row=0;row<14;row++) {
            const y=height-185-row*23
            commands.push('0.16 0.18 0.22 rg',`BT /F1 12 Tf 40 ${y} Td (FLEX review section ${row+1}: document layout, text, drawing and page navigation.) Tj ET`)
            if(landscape){
                const r=((index+row)%5+2)/8,g=((index+row*2)%5+2)/8
                commands.push(`${r} ${g} 0.72 rg`,`730 ${y-4} 180 18 re f`)
            }
        }
        const stream=commands.join('\n')+'\n'
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`)
        objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
    }
    objects[0]='<< /Type /Catalog /Pages 2 0 R >>'
    objects[1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${pages} >>`
    let pdf='%PDF-1.7\n';const offsets=[0]
    for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`}
    const xref=Buffer.byteLength(pdf)
    pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')
    pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(pdf)
}

export async function installBrochureFixture(page,options) {
    const body=brochureFixture(options)
    await page.route('**/brochures/*.pdf',route=>route.fulfill({body,contentType:'application/pdf'}))
}
