// RF-08.6: el tablero suprime toda celda por debajo del umbral en vez de publicarla (riesgo de reidentificación) y
// no publica un total, para que no se pueda restar de él el valor suprimido. Declara su fecha de corte (RNF-06).
export const armarTablero = ({ celdas, anios, corte, umbral }) => ({
  corte: corte ? corte.toISOString() : null,
  umbral,
  anios,
  regiones: celdas
    .map((c) => (c.total < umbral ? { region: c.region, diplomas: null, suprimido: true } : { region: c.region, diplomas: c.total, suprimido: false }))
    .sort((a, b) => a.region.localeCompare(b.region, 'es')),
})
