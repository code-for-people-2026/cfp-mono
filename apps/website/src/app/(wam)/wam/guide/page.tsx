import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '为什么是这个矩阵？ · 牛马能力剥夺矩阵',
  description: '解释 7 类工友与 7 样能力如何构成 WAM 方向矩阵。',
}

const groups = [
  ['一产', '农林牧渔、村医、乡村教师，是被互联网长期低估的一线生产者。'],
  ['二产', '建筑、电子厂、装修、化工等劳动者，处在最典型的雇佣劳动和劳动保护问题里。'],
  ['服务业新蓝领', '骑手、快递、网约车、家政、月嫂、保安，是平台经济制造出来的新劳动形态。'],
  ['个体经营', '夫妻店、小餐馆、小摊、回收工，介于小资产经营和被平台抽成的劳动之间。'],
  ['过渡·失业·待业', '返乡、工伤、长期失业、应届未就业、NEET，处在劳动力市场的夹缝里。'],
  ['无偿再生产', '全职妈妈和照顾者也在生产劳动力，只是这种劳动常被家庭和统计系统隐形化。'],
  ['低级白领', '码农、运营、文员等脑力劳动者正在被去技能化，所以纳入，但标记为最低优先。'],
]

const capabilities = [
  ['劳动议价', '经济参与的能力：挣多少、价格怎么定、劳动价值能不能被看见。'],
  ['时间主权', '自主支配时间的能力：排班、接单、加班、照顾责任是否被别人安排。'],
  ['信任维权', '在制度内主张权利的能力：证据、合同、认证、追偿、合规。'],
  ['健康医疗', '维持身体的能力：诊疗、慢病、职业病、心理压力和医疗可及性。'],
  ['家庭再生产', '维系亲属关系的能力：育儿、养老、照护、远程陪伴和家庭协作。'],
  ['社交表达', '连接与发声的能力：互助、恋爱、社区、表达渠道和被听见。'],
  ['教育技能', '持续成长的能力：学技能、转行、理解工具、把经验变成可迁移能力。'],
]

export default function MatrixGuidePage() {
  return (
    <main className="app-shell guide-shell">
      <header className="guide-topbar">
        <Link className="guide-back-icon" href="/wam" aria-label="返回矩阵" title="返回矩阵">
          <ArrowLeft size={22} strokeWidth={2.4} />
        </Link>
        <div>
          <div className="kicker">WAM · Worker Ability Matrix</div>
          <h1>为什么是这个矩阵？</h1>
          <p className="matrix-subtitle">7 类工友 × 7 样能力 = 49 个方向。</p>
        </div>
      </header>

      <section className="guide-lede" aria-label="矩阵总览">
        <p>
          这个矩阵不是用来宣布“哪个产品最好”，而是用来检查：哪些人、哪些被剥夺的能力，还没有被认真看见。
          横轴问的是人在生产关系里的位置，纵轴问的是人被平台、资本和制度拿走了哪些行动能力。
        </p>
      </section>

      <section className="guide-section">
        <h2>为什么按这 7 类工友分？</h2>
        <p>
          横轴不是行业表，而是生产关系坐标。我们关心的不是“他在哪个行业”，而是他是否占有平台、数据与算法，
          是否只能出卖劳动、交租、被抽成，或者承担了不被承认为工作的再生产劳动。
        </p>
        <div className="guide-list">
          {groups.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section">
        <h2>为什么是这 7 样能力？</h2>
        <p>
          纵轴来自 Amartya Sen 的能力进路：人的福祉不只看消费了什么，而要看“能做什么”。放到软件和 AI
          语境里，就是看哪些能力可以被工具补回来，哪些能力不能再只交给平台定价。
        </p>
        <p className="guide-source">
          能力依据延伸阅读：
          <a href="https://fddi.fudan.edu.cn/45/c4/c18965a411076/page.htm" target="_blank" rel="noreferrer">
            复旦发展研究院《张军读经典：森〈以自由看待发展〉的博大精深》
          </a>
        </p>
        <div className="guide-list guide-list-compact">
          {capabilities.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
