// Génération du compte-rendu Word (tableau des annotations + page de garde).
const FONT = 'Source Sans Pro'
const SIZE = 20 // 10 pt
const SKY = '5EB6EE', INK = '20262B', GREY = '5A6872'
const ST = {
  rouge: { l: 'À reprendre', c: 'D64545', bg: 'FBE4E4' },
  bleu: { l: 'Demande d’information', c: '2F7FD1', bg: 'E1EEFB' },
  vert: { l: 'Conforme', c: '2E9E5B', bg: 'E0F3E8' },
}
const COLS = [600, 2100, 1700, 1500, 5000, 4538] // total 15438 (A4 paysage, marges 700)
const TOTAL = COLS.reduce((a, b) => a + b, 0)

const INTRO = [
  'ALTIA est le bureau d’étude acoustique en charge de la mission d’assistance acoustique à la maîtrise d’œuvre en phase chantier et réception.',
  'Dans le cadre de sa mission VISA, ALTIA doit valider l’ensemble des ouvrages mis en œuvre par les Entreprises ayant un impact sur les aspects acoustiques du bâtiment.',
  'Pour cela, les Entreprises doivent prendre en compte les pièces acoustiques du dossier marché et respecter les exigences acoustiques décrites dans ces pièces.',
  'Les Entreprises doivent nous fournir les pièces demandées par ALTIA afin de donner son VISA. Un VISA favorable doit être donné par l’ensemble de la maîtrise d’œuvre, y compris ALTIA, avant toute commande ou pose de matériels ou matériaux. Toute modification par rapport à la notice acoustique devra faire l’objet d’une demande écrite de l’entreprise et d’une validation d’ALTIA.',
  'Afin de lever les remarques effectuées dans le présent compte-rendu, les entreprises concernées devront transmettre des photographies des reprises effectuées conformément aux demandes d’ALTIA.',
]

export const fmtDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

// rows : [{ prob, statut, layer, note, photos: [Uint8Array] }] déjà triées
export async function buildWord({ projectName, dateIso, dossier, author, rows }) {
  const D = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer, PageNumber, AlignmentType, BorderStyle, WidthType, ShadingType, PageOrientation, VerticalAlign } = D

  const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || SIZE, bold: o.bold, italics: o.italics, color: o.color })
  const para = (text, o = {}) => new Paragraph({ spacing: { after: o.after || 0 }, alignment: o.align, children: [run(text, o)] })

  const date = fmtDate(dateIso)
  const title = `Compte-rendu - Visite de chantier du ${date}`

  // ----- Page de garde -----
  const label = (k, v) => new Paragraph({ spacing: { after: 80 }, children: [run(k + ' : ', { bold: true }), run(v)] })
  const cover = [
    new Paragraph({ spacing: { after: 600 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: SKY, space: 6 } }, children: [run('ALTIA', { bold: true, size: 32, color: INK }), run('   Acoustique', { size: SIZE, color: GREY })] }),
    new Paragraph({ spacing: { after: 360 }, children: [run(title, { bold: true, size: 32, color: INK })] }),
    label('Projet', projectName),
    label('N° de dossier', dossier || '…………………'),
    label('Rédacteur', author.name),
    label('E-mail', author.email),
    new Paragraph({ spacing: { after: 480 }, children: [] }),
    ...INTRO.map((t) => new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.JUSTIFIED, children: [run(t)] })),
  ]

  // ----- Tableau -----
  const bd = { style: BorderStyle.SINGLE, size: 4, color: 'C9D2D9' }
  const borders = { top: bd, bottom: bd, left: bd, right: bd }
  const margins = { top: 70, bottom: 70, left: 90, right: 90 }
  const cell = (i, children, o = {}) => new TableCell({
    width: { size: COLS[i], type: WidthType.DXA }, borders, margins, rowSpan: o.rowSpan,
    verticalAlign: o.va || VerticalAlign.TOP,
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } : undefined, children,
  })
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: ['N°', 'Problématique', 'Priorité', 'Date', 'Commentaire', 'Photos'].map((h, i) =>
      cell(i, [para(h, { bold: true, color: 'FFFFFF' })], { bg: INK, va: VerticalAlign.CENTER })),
  })

  // taille de chaque groupe de problématique (cellule fusionnée)
  const span = {}
  rows.forEach((r, i) => { if (i === 0 || rows[i - 1].prob !== r.prob) span[i] = rows.slice(i).findIndex((x) => x.prob !== r.prob) })
  Object.keys(span).forEach((i) => { if (span[i] < 0) span[i] = rows.length - i })

  const body = rows.map((r, i) => {
    const s = ST[r.statut] || ST.rouge
    const imgs = r.photos.map((data, k) => new ImageRun({ type: 'jpg', data, transformation: { width: 90, height: 90 }, altText: { title: 'Photo', description: 'Photo', name: `photo-${i}-${k}` } }))
    const photoP = imgs.length
      ? [new Paragraph({ spacing: { after: 0 }, children: imgs.flatMap((im, k) => (k ? [new TextRun({ text: '  ', font: FONT, size: SIZE }), im] : [im])) })]
      : [para('—', { color: '8A97A1' })]
    const cells = [cell(0, [para(String(i + 1), { color: GREY })])]
    if (span[i] !== undefined) cells.push(cell(1, [para(r.prob, { bold: true })], { rowSpan: span[i] }))
    cells.push(
      cell(2, [new Paragraph({ spacing: { after: 0 }, children: [run('● ', { color: s.c }), run(s.l, { bold: true })] })], { bg: s.bg }),
      cell(3, [para(r.layer)]),
      cell(4, (r.note || '—').split('\n').map((t) => para(t, { color: r.note ? undefined : '8A97A1' }))),
      cell(5, photoP),
    )
    return new TableRow({ cantSplit: true, children: cells })
  })
  const table = new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: COLS, rows: [head, ...body] })

  const footer = () => new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
    run('Page ', { size: 16, color: GREY }),
    new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GREY }),
    run(' / ', { size: 16, color: GREY }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY }),
  ] })] })

  const doc = new Document({
    title, creator: author.name,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1000, left: 1300, right: 1300 } } },
        footers: { default: footer() },
        children: cover,
      },
      {
        properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 900, bottom: 800, left: 700, right: 700 } } },
        headers: { default: new Header({ children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: SKY, space: 4 } },
          tabStops: [{ type: 'right', position: TOTAL }],
          children: [run('ALTIA', { bold: true, color: INK }), run(`\t${projectName} · ${title}`, { color: GREY })],
        })] }) },
        footers: { default: footer() },
        children: [table],
      },
    ],
  })
  return Packer.toBlob(doc)
}
