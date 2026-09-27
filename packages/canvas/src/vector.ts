function svgNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

export function shapePathData(
  tag: string,
  attributes: Record<string, string>,
): string | null {
  if (tag === 'path' && attributes.d) return attributes.d
  if (tag === 'circle') {
    const cx = svgNumber(attributes.cx)
    const cy = svgNumber(attributes.cy)
    const r = svgNumber(attributes.r)
    if (r <= 0) return null
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
  }
  if (tag === 'ellipse') {
    const cx = svgNumber(attributes.cx)
    const cy = svgNumber(attributes.cy)
    const rx = svgNumber(attributes.rx)
    const ry = svgNumber(attributes.ry)
    if (rx <= 0 || ry <= 0) return null
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
  }
  if (tag === 'rect') {
    const x = svgNumber(attributes.x)
    const y = svgNumber(attributes.y)
    const width = svgNumber(attributes.width)
    const height = svgNumber(attributes.height)
    const rx = Math.min(svgNumber(attributes.rx), width / 2)
    const ry = Math.min(
      svgNumber(attributes.ry, svgNumber(attributes.rx)),
      height / 2,
    )
    if (width <= 0 || height <= 0) return null
    if (rx <= 0 && ry <= 0) {
      return `M ${x} ${y} h ${width} v ${height} h ${-width} z`
    }
    return [
      `M ${x + rx} ${y}`,
      `H ${x + width - rx}`,
      `A ${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
      `V ${y + height - ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
      `H ${x + rx}`,
      `A ${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
      `V ${y + ry}`,
      `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
      'Z',
    ].join(' ')
  }
  if (tag === 'line') {
    const x1 = svgNumber(attributes.x1)
    const y1 = svgNumber(attributes.y1)
    const x2 = svgNumber(attributes.x2)
    const y2 = svgNumber(attributes.y2)
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const points = (attributes.points || '')
      .trim()
      .split(/[\s,]+/)
      .map(Number.parseFloat)
      .filter(Number.isFinite)
    if (points.length < 4) return null
    const pairs: string[] = []
    for (let index = 0; index + 1 < points.length; index += 2) {
      pairs.push(`${points[index]} ${points[index + 1]}`)
    }
    const path = pairs.map((pair, index) =>
      index === 0 ? `M ${pair}` : `L ${pair}`,
    )
    if (tag === 'polygon') path.push('Z')
    return path.join(' ')
  }
  return null
}
