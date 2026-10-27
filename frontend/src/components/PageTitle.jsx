export function PageTitle({ title, detail }) {
  return <header className="page-heading"><div><div className="eyebrow">MINT FINANCE</div><h1>{title}</h1><p>{detail}</p></div></header>;
}

export function PlaceholderPage({ title, detail }) {
  return <section className="page-section"><PageTitle title={title} detail={detail} /><div className="panel placeholder-panel"><span className="empty-icon">?</span><p>{detail}</p></div></section>;
}
