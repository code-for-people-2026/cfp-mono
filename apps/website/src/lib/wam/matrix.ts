export type MatrixTagTone = 'red' | 'blue' | 'empty' | 'black' | 'gold' | 'star'

type MatrixTagBase = {
  tone: MatrixTagTone
  text: string
}

export type MatrixProductTag = MatrixTagBase & {
  kind: 'product'
  tone: 'red' | 'black' | 'gold'
  name: string
  description: string
}

export type MatrixNeedTag = MatrixTagBase & {
  kind: 'need'
  tone: 'blue'
  need: string
}

export type MatrixCoverageGapTag = MatrixTagBase & {
  kind: 'coverageGap'
  tone: 'empty'
  label: string
}

export type MatrixProgramTag = MatrixTagBase & {
  kind: 'program'
  tone: 'star'
  title: string
  description: string
}

export type MatrixTag = MatrixProductTag | MatrixNeedTag | MatrixCoverageGapTag | MatrixProgramTag

type MatrixTagSource = MatrixTagBase

export type MatrixRow = {
  id: string
  index: number
  title: string
  subtitle: string
}

export type MatrixColumn = {
  id: string
  letter: string
  title: string
  subtitle: string
  unsegmented?: boolean
}

export type MatrixCell = {
  id: string
  rowId: string
  columnId: string
  rowTitle: string
  columnTitle: string
  tags: MatrixTag[]
}

type MatrixColumnLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
type MatrixRowIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type MatrixCellId = `${MatrixColumnLetter}${MatrixRowIndex}`

export const MATRIX_ROWS: MatrixRow[] = [
  { id: 'labor-bargaining', index: 1, title: '劳动议价', subtitle: '挣多少能不能谈' },
  { id: 'time-sovereignty', index: 2, title: '时间主权', subtitle: '谁支配你的时间' },
  { id: 'trust-rights', index: 3, title: '信任维权', subtitle: '制度内主张权利' },
  { id: 'healthcare', index: 4, title: '健康医疗', subtitle: '维持身体' },
  { id: 'family-reproduction', index: 5, title: '家庭再生产', subtitle: '育儿养老' },
  { id: 'social-expression', index: 6, title: '社交表达', subtitle: '连接与发声' },
  { id: 'education-skills', index: 7, title: '教育技能', subtitle: '持续成长' },
]

export const MATRIX_COLUMNS: MatrixColumn[] = [
  { id: 'primary-sector', letter: 'A', title: '一产', subtitle: '农林牧渔/村医' },
  { id: 'secondary-sector', letter: 'B', title: '二产', subtitle: '建筑/电子厂/装修' },
  { id: 'new-blue-collar', letter: 'C', title: '服务业新蓝领', subtitle: '骑手/快递/网约车/家政' },
  { id: 'self-employed', letter: 'D', title: '个体经营', subtitle: '夫妻店/小摊/回收' },
  { id: 'transition-unemployed', letter: 'E', title: '过渡·失业·待业', subtitle: '返乡/工伤/NEET' },
  { id: 'unpaid-reproduction', letter: 'F', title: '无偿再生产', subtitle: '全职妈妈/照顾者' },
  { id: 'junior-white-collar', letter: 'G', title: '低级白领', subtitle: '(最低优先)码农/运营/文员' },
  {
    id: 'unsegmented',
    letter: 'H',
    title: '未细分',
    subtitle: '所有人都在用，谁都没被认真服务',
    unsegmented: true,
  },
]

function splitNameAndDescription(text: string) {
  const separatorIndex = text.indexOf('：')
  if (separatorIndex < 0) {
    return {
      name: text,
      description: '',
    }
  }

  return {
    name: text.slice(0, separatorIndex).trim(),
    description: text.slice(separatorIndex + 1).trim(),
  }
}

function createMatrixTag(source: MatrixTagSource): MatrixTag {
  if (source.tone === 'blue') {
    return {
      ...source,
      tone: 'blue',
      kind: 'need',
      need: source.text,
    }
  }

  if (source.tone === 'empty') {
    return {
      ...source,
      tone: 'empty',
      kind: 'coverageGap',
      label: source.text,
    }
  }

  if (source.tone === 'star') {
    const { name, description } = splitNameAndDescription(source.text)

    return {
      ...source,
      tone: 'star',
      kind: 'program',
      title: name,
      description,
    }
  }

  const { name, description } = splitNameAndDescription(source.text)
  return {
    ...source,
    tone: source.tone,
    kind: 'product',
    name,
    description,
  }
}

const CELL_TAGS: Record<string, MatrixTagSource[]> = {
  A1: [
    { tone: 'gold', text: '拼多多：农货上行，产地直连买家' },
    { tone: 'blue', text: '农产品价格透明 + 直采对接' },
  ],
  B1: [
    { tone: 'red', text: '鱼泡网：工地招工记工' },
    { tone: 'blue', text: '电子厂工时工资自动核对' },
  ],
  C1: [
    { tone: 'black', text: '哈啰：顺风车高速费议价' },
    { tone: 'gold', text: '胖东来：把利让给员工而非股东' },
    { tone: 'blue', text: '骑手收入/补贴预测' },
  ],
  D1: [
    { tone: 'black', text: '美团：商家经营后台' },
    { tone: 'black', text: '拼多多：仅退款+强制比价，小商家利润压到地板' },
    { tone: 'blue', text: '小餐馆·夫妻店经营助手 / 回收价' },
  ],
  E1: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '零工跨平台社保+收入聚合' },
  ],
  F1: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '家务劳动价值量化报告' },
  ],
  G1: [
    { tone: 'red', text: '脉脉：职言薪资爆料' },
    { tone: 'blue', text: '跨公司薪资透明 + 副业匹配' },
  ],
  H1: [{ tone: 'black', text: '58同城：向找活的人收信息费，假岗位泛滥' }],
  A2: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '农时季节排程助手' },
  ],
  B2: [
    { tone: 'black', text: '钉钉：考勤打卡' },
    { tone: 'blue', text: '加班/调休/请假管理+维权' },
  ],
  C2: [
    { tone: 'black', text: '滴滴：网约车时间规划' },
    { tone: 'red', text: '高德：导航+聚合打车，司机的日常工具' },
    { tone: 'blue', text: '代驾/网约车 单价博弈+时间规划' },
  ],
  D2: [
    { tone: 'black', text: '饿了么：商家营业设置' },
    { tone: 'blue', text: '营业时间+接单优化' },
  ],
  E2: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '多份兼职时间冲突调度' },
  ],
  F2: [
    { tone: 'red', text: '京东健康：上门护理预约' },
    { tone: 'blue', text: '喘息服务匹配(短期托管)' },
  ],
  G2: [
    { tone: 'black', text: '飞书：考勤工时统计' },
    { tone: 'black', text: '拼多多："本分"文化超长工时，客服运营当耗材' },
    { tone: 'blue', text: '996 记录 + 合规举报' },
  ],
  H2: [{ tone: 'black', text: '抖音/王者荣耀：算法围猎注意力，你的时间是它的库存' }],
  A3: [
    { tone: 'red', text: '蚂蚁链：农产品溯源' },
    { tone: 'blue', text: '农产品溯源+品牌认证' },
  ],
  B3: [
    { tone: 'red', text: '国务院客户端：欠薪线索反映' },
    { tone: 'blue', text: '建筑工欠薪维权 AI(证据/起诉书)' },
  ],
  C3: [
    { tone: 'black', text: '天鹅到家：阿姨背景核验' },
    { tone: 'blue', text: '家政/月嫂 vetting + 客户管理' },
  ],
  D3: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '摊贩城管动态+选址+合规' },
  ],
  E3: [
    { tone: 'red', text: '国家政务服务平台：补贴查询' },
    { tone: 'blue', text: '退役/失业 资格认证+政策福利' },
  ],
  F3: [
    { tone: 'red', text: '找法网：离婚律师咨询' },
    { tone: 'blue', text: '离婚财产分割维权(无偿劳动评估)' },
  ],
  G3: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '劳动合同审查 + N+1 谈判' },
  ],
  H3: [
    { tone: 'black', text: '天眼查：工商数据本是公开的，圈起来卖会员' },
    { tone: 'black', text: '裁判文书网：判决书公开量锐减，普通人查不到同案判例' },
  ],
  A4: [
    { tone: 'red', text: '微医：互联网问诊' },
    { tone: 'blue', text: '村医 AI 辅助诊断' },
  ],
  B4: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '职业病(粉尘/重金属)长期监测' },
  ],
  C4: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '货车司机健康监测+远程亲子' },
  ],
  D4: [
    { tone: 'red', text: 'Keep：肩颈放松课程' },
    { tone: 'blue', text: '小老板过劳/颈椎自管' },
  ],
  E4: [
    { tone: 'red', text: '支付宝：社保工伤查询' },
    { tone: 'blue', text: '工伤认定流程导航+同病互助' },
  ],
  F4: [
    { tone: 'red', text: '美柚：女性健康管理' },
    { tone: 'blue', text: '照顾者心理健康 / 女性专属健康' },
  ],
  G4: [
    { tone: 'red', text: '丁香医生：健康科普问诊' },
    { tone: 'blue', text: '体检报告解读+慢病筛查' },
  ],
  H4: [{ tone: 'black', text: '百度：竞价排名卖医疗广告，搜症状越搜越慌' }],
  A5: [
    { tone: 'red', text: '国家中小学智慧教育平台' },
    { tone: 'blue', text: '农村远程教育+跨代辅导' },
  ],
  B5: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '宿舍家属互助+集体托管' },
  ],
  C5: [
    { tone: 'red', text: '宝宝树：新手妈妈育儿' },
    { tone: 'blue', text: '新手妈妈育儿+AI问诊' },
  ],
  D5: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '夫妻店家庭分工协调' },
  ],
  E5: [
    { tone: 'red', text: '小天才：手表亲情通话' },
    { tone: 'blue', text: '留守儿童 AI 视频陪伴' },
  ],
  F5: [
    { tone: 'red', text: '亲宝宝：家庭育儿记录' },
    { tone: 'blue', text: '育儿/养老 AI 助手 + 反丧偶育儿' },
  ],
  G5: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '异地家庭管理 + 代际沟通' },
  ],
  H5: [
    { tone: 'red', text: '微信：全民家庭视频通话' },
    { tone: 'black', text: '小红书：制造育儿焦虑，种草卖货' },
    { tone: 'black', text: '淘宝/京东：万能货架，谁都服务=谁都没被服务' },
  ],
  A6: [
    { tone: 'gold', text: '抖音/快手：直播带货，砍掉中间商' },
    { tone: 'blue', text: '乡村文艺/直播带货组织' },
  ],
  B6: [
    { tone: 'red', text: '伊对：视频相亲' },
    { tone: 'blue', text: '电子厂女工 跨地恋爱/婚介' },
  ],
  C6: [
    { tone: 'red', text: '世纪佳缘：婚恋平台' },
    { tone: 'red', text: 'QQ：工友群/老乡群的默认载体' },
    { tone: 'blue', text: '蓝领相亲/工友互助圈' },
  ],
  D6: [
    { tone: 'red', text: '多多买菜：社区团购' },
    { tone: 'blue', text: '小镇社区私域+团购组织' },
  ],
  E6: [
    { tone: 'red', text: '豆瓣：失业互助小组' },
    { tone: 'blue', text: '失业抑郁援助互助' },
  ],
  F6: [
    { tone: 'red', text: '小红书：妈妈社区' },
    { tone: 'blue', text: '照顾者互助社群 / 女性主义自媒体' },
  ],
  G6: [
    { tone: 'red', text: '脉脉：职场吐槽社区' },
    { tone: 'black', text: '视觉中国：碰瓷式版权诉讼，围猎自媒体小编' },
    { tone: 'blue', text: '反内卷自媒体 + 同辈互助小组' },
  ],
  H6: [
    { tone: 'black', text: '微信：公众号收平台税，表达先给平台交租' },
    { tone: 'gold', text: '华语辩坛小友赛：不带货、不收割，把发声的擂台让给年轻人' },
    { tone: 'gold', text: 'DeepSeek：开源压平全行业 token 价格，AI 对话人人用得起' },
  ],
  A7: [
    { tone: 'red', text: '快手：三农技术短视频' },
    { tone: 'blue', text: '农技/养殖/兽医助手' },
  ],
  B7: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '普工->技工->调试 技能阶梯' },
  ],
  C7: [
    { tone: 'black', text: '美团大学：商家骑手培训' },
    { tone: 'blue', text: '服务业语言/营销/沟通' },
  ],
  D7: [
    { tone: 'black', text: '抖音：电商商家课堂' },
    { tone: 'blue', text: '数字化经营/抖音获客' },
  ],
  E7: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '50+ 二次就业 + 短视频' },
  ],
  F7: [
    { tone: 'empty', text: '大厂未覆盖' },
    { tone: 'blue', text: '全职妈妈重返职场准备' },
  ],
  G7: [
    { tone: 'red', text: '粉笔：考公考编培训' },
    { tone: 'blue', text: '考研考公导师 / 转行规划' },
  ],
  H7: [
    {
      tone: 'star',
      text: '我们的纲领与方向地图：这张 7×7 矩阵——给每个有马克思主义理想的同路人一份可上手的实践地图（是纲领/教材，不是给工友用的软件产品）',
    },
    { tone: 'black', text: '猿辅导/学而思们：贩卖升学焦虑卖课' },
  ],
}

export const MATRIX_CELLS: MatrixCell[] = MATRIX_ROWS.flatMap((row) =>
  MATRIX_COLUMNS.map((column) => {
    const id = `${column.letter}${row.index}`

    return {
      id,
      rowId: row.id,
      columnId: column.id,
      rowTitle: row.title,
      columnTitle: column.title,
      tags: (CELL_TAGS[id] ?? []).map(createMatrixTag),
    }
  })
)

export const MATRIX_CELL_IDS = MATRIX_CELLS.map((cell) => cell.id) as MatrixCellId[]

export function isMatrixCellId(cellId: string): cellId is MatrixCellId {
  return MATRIX_CELL_IDS.includes(cellId as MatrixCellId)
}

export function getMatrixCell(cellId: string): MatrixCell | undefined {
  const normalizedId = cellId.trim().toUpperCase()
  return MATRIX_CELLS.find((cell) => cell.id === normalizedId)
}
