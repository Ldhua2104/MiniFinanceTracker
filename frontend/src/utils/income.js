export function incomeSourceLabel(name, t) {
  const key = { other: 'otherSource', salary: 'salarySource', bonus: 'bonusSource' }[name.trim().toLocaleLowerCase()];
  return key ? t(key) : name;
}
