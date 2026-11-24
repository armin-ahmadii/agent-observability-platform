// Grey placeholder shown while a session loads (first load, switching, and until short titles arrive).
const Row = () => <div className="sk-row"><i className="sk sq" /><i className="sk w40" /><i className="sk w15" /><span className="sk-sp" /><i className="sk w8" /><i className="sk w8" /></div>
const SmallRow = () => <div className="sk-row"><i className="sk sq sm" /><i className="sk w20" /><span className="sk-sp" /><i className="sk w6" /><i className="sk w8" /></div>
export function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="sk-stats"><div><i className="sk w30 sm" /><i className="sk w45 lg" /></div><div><i className="sk w30 sm" /><i className="sk w35 lg" /></div></div>
      <div className="sk-head"><i className="sk w20" /></div>
      <Row /><Row /><Row /><Row />
      <div className="sk-head"><i className="sk w25" /></div>
      <SmallRow /><SmallRow />
    </div>
  )
}
