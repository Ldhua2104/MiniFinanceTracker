import { formatCents, formatSignedCents, moneyToCents } from '../utils/finance.js';

export function TrendChart({ account, points, t, locale }) {
  const width = 700;
  const height = 250;
  const left = 72;
  const right = 20;
  const top = 20;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(1, ...points.flatMap((item) => [Number(item.income), Number(item.expense)]));
  const x = (index) => left + index * (chartWidth / (points.length - 1));
  const y = (amount) => top + chartHeight - (Number(amount) / max) * chartHeight;
  const smoothPath = (type) => {
    const coordinates = points.map((item, index) => ({ x: x(index), y: y(item[type]) }));
    if (coordinates.length === 0) return '';
    if (coordinates.length === 1) return `M ${coordinates[0].x} ${coordinates[0].y}`;
    const slopes = coordinates.slice(0, -1).map((point, index) =>
      (coordinates[index + 1].y - point.y) / (coordinates[index + 1].x - point.x));
    const tangents = coordinates.map((_, index) => {
      if (index === 0) return slopes[0];
      if (index === coordinates.length - 1) return slopes.at(-1);
      const previous = slopes[index - 1];
      const next = slopes[index];
      return previous * next <= 0 ? 0 : (2 * previous * next) / (previous + next);
    });

    for (let index = 0; index < slopes.length; index += 1) {
      const slope = slopes[index];
      if (slope === 0) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
        continue;
      }
      const alpha = tangents[index] / slope;
      const beta = tangents[index + 1] / slope;
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[index] = scale * alpha * slope;
        tangents[index + 1] = scale * beta * slope;
      }
    }

    return coordinates.slice(1).reduce((path, current, index) => {
      const previous = coordinates[index];
      const segmentWidth = current.x - previous.x;
      const control1 = { x: previous.x + segmentWidth / 3, y: previous.y + tangents[index] * segmentWidth / 3 };
      const control2 = { x: current.x - segmentWidth / 3, y: current.y - tangents[index + 1] * segmentWidth / 3 };
      const start = index === 0 ? `M ${previous.x} ${previous.y}` : path;
      return `${start} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${current.x} ${current.y}`;
    }, '');
  };
  const ticks = [0, max / 2, max];
  const formatTick = (cents) => formatCents(BigInt(Math.round(cents)), locale, account.currency);
  return (
    <section className="panel trend-panel">
      <div className="panel-heading"><div><div className="eyebrow">{t('fiveDayTrend')}</div><h2>{account.name}</h2></div><span className="trend-currency">{account.currency}</span></div>
      <div className="chart-legend"><span><i className="legend-income" />{t('income')}</span><span><i className="legend-expense" />{t('expense')}</span></div>
      <div className="chart-scroll">
        <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('fiveDayTrend')}>
          {ticks.map((tick, index) => {
            const yy = y(BigInt(Math.round(tick)));
            return <g key={index}><line x1={left} x2={width - right} y1={yy} y2={yy} className="chart-gridline" /><text x={left - 9} y={yy + 4} textAnchor="end" className="chart-axis-label">{formatTick(tick)}</text></g>;
          })}
          <path d={smoothPath('income')} className="chart-line income-line" />
          <path d={smoothPath('expense')} className="chart-line expense-line" />
          {points.map((point, index) => <g key={point.date}>
            <circle cx={x(index)} cy={y(point.income)} r="4" className="chart-point income-point" />
            <circle cx={x(index)} cy={y(point.expense)} r="4" className="chart-point expense-point" />
            <text x={x(index)} y={height - 12} textAnchor="middle" className="chart-axis-label">{point.label}</text>
          </g>)}
        </svg>
      </div>
    </section>
  );
}
