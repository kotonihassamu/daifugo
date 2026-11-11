// ゲーム中・待合室の「ルール」ボタンで出す説明。
// 地域差が出るルール(効果・縛り・革命)を先に、基本ルールは最後に置く。
import { SUIT_SYMBOL } from '../cards.js';

// 小さなカード表示 c('H2') / c('JK')
function c(code) {
  if (code === 'JK') return '<span class="mc jk">JOKER</span>';
  const s = code[0], r = code[1] === 'T' ? '10' : code.slice(1);
  const red = s === 'H' || s === 'D';
  return `<span class="mc${red ? ' red' : ''}">${SUIT_SYMBOL[s]}${r}</span>`;
}
const cs = (...codes) => `<span class="mcs">${codes.map(c).join('')}</span>`;
const OK = '<span class="verdict ok">✓</span>';
const NG = '<span class="verdict ng">✕</span>';
const ex = (left, right, verdict, note) =>
  `<div class="ex-row"><div class="ex-cards">${left}<span class="ex-arrow">→</span>${right}</div><div class="ex-note">${verdict}<span>${note}</span></div></div>`;

const tile = (rank, name, what, chips, tone) => `
  <div class="fx-tile ${tone}">
    <div class="fx-head"><span class="fx-rank">${rank}</span><b>${name}</b></div>
    <div class="fx-what">${what}</div>
    <div class="fx-chips">${chips.map((x) => `<span class="chip ${x.startsWith('×') ? 'no' : ''}">${x}</span>`).join('')}</div>
  </div>`;

export const RULES_HTML = `
<h2>ルール</h2>
<nav class="rules-nav">
  <button data-jump="r-point">この部屋の特徴</button>
  <button data-jump="r-fx">効果</button>
  <button data-jump="r-lock">縛り</button>
  <button data-jump="r-rev">革命</button>
  <button data-jump="r-order">処理順</button>
  <button data-jump="r-joker">ジョーカー</button>
  <button data-jump="r-match">連戦</button>
  <button data-jump="r-basic">基本</button>
</nav>

<section id="r-point" class="rule-sec">
  <h3>この部屋のルールの特徴</h3>
  <ul class="point-list">
    <li><b>効果はすべて強制</b>:条件を満たすと必ず発動(選べない)</li>
    <li><b>縛りは「完全一致」だけ</b>:片縛りはなし</li>
    <li><b>階段の革命は同じマークだけ</b>:マークが混ざった階段では起きない</li>
    <li><b>パスは何回でもOK</b>:パスしても次の手番では出せる</li>
    <li><b>都落ちあり・反則上がりなし</b>:何で上がってもOK</li>
  </ul>
</section>

<section id="r-fx" class="rule-sec">
  <h3>効果(出した手に含まれる数字で発動)</h3>
  <div class="fx-grid">
    ${tile('8', '8切り', '場が流れて、<b>出した人から</b>また出せる', ['階段の中でも', '他の効果の後'], 'gold')}
    ${tile('5', '5スキップ', '5の枚数分、<b>次の人から順に手番を飛ばす</b>', ['階段の中でも', '8切りと一緒なら×'], 'blue')}
    ${tile('7', '7渡し', '7の枚数分、<b>好きなカードを次の人に渡す</b>', ['階段の中でも', '渡すカードは相手だけに見える'], 'green')}
    ${tile('10', '10捨て', '10の枚数分、<b>好きなカードを捨てる</b>', ['階段の中でも', '捨てたカードは全員に見える'], 'green')}
    ${tile('J', '11バック', '<b>場が流れるまで強さが逆転</b>', ['×階段の中のJ', '革命中なら元の強さに'], 'purple')}
    ${tile('Q', '12ボンバー', 'Qの枚数分、<b>数字(かジョーカー)を指定</b>。全員の手札からその数字が消える', ['階段の中でも', '自分の手札も消える'], 'orange')}
    ${tile('♠3', 'スペ3返し', '単体のジョーカーに<b>♠3を1枚出すと勝てる</b>。その後は場が流れる', ['縛り中でも可'], 'gold')}
    ${tile('革', '革命', '<b>強さが逆転</b>。場が流れても続く', ['同じ数字4枚', '同じマーク4枚以上の階段'], 'red')}
  </div>
  <p class="note">7渡し・10捨てで手札が0枚になったら、その時点で上がりです。</p>
</section>

<section id="r-lock" class="rule-sec">
  <h3>縛り(場が流れたら解除)</h3>
  <div class="rule-card">
    <h4>マーク縛り:マークの組み合わせが<em>完全に一致</em>したら成立</h4>
    ${ex(cs('H2', 'S2'), cs('H4', 'S4'), OK, '縛り成立。次も ♥♠ の組み合わせだけ')}
    ${ex(cs('H2', 'S2'), cs('H4', 'C4'), NG, '♥しか合っていないので縛りにならない')}
    <p class="note">ジョーカーはどのマークの代わりにもなれます。</p>
  </div>
  <div class="rule-card">
    <h4>数字縛り:<em>1つ強い数字</em>を続けて出したら成立</h4>
    ${ex(cs('S5'), cs('H6'), OK, '縛り成立。次は <b>7だけ</b>、その次は8だけ…')}
    ${ex(cs('S5', 'S6', 'S7'), cs('H6', 'H7', 'H8'), OK, '階段も同じ。次は 7-8-9 だけ')}
    <p class="note">次の数字がない(2の次など)ときは、誰も出せず場が流れます。<br>マーク縛りと数字縛りは同時にかかることもあります。</p>
  </div>
</section>

<section id="r-rev" class="rule-sec">
  <h3>革命</h3>
  <div class="rule-card">
    <h4>起きる手</h4>
    <div class="ex-row"><div class="ex-cards">${cs('S9', 'H9', 'D9', 'C9')}</div><div class="ex-note">${OK}<span>同じ数字4枚(ジョーカー入りもOK)</span></div></div>
    <div class="ex-row"><div class="ex-cards">${cs('S5', 'S6', 'S7', 'S8')}</div><div class="ex-note">${OK}<span>同じマークの4枚以上の階段</span></div></div>
    <div class="ex-row"><div class="ex-cards">${cs('S5', 'H6', 'S7', 'S8')}</div><div class="ex-note">${NG}<span>マークが混ざった階段(出せるが革命は起きない)</span></div></div>
  </div>
  <div class="rule-card">
    <h4>革命中は</h4>
    <ul>
      <li>強さが逆転:<b>3が最強、2が最弱</b>(ジョーカーは常に最強)</li>
      <li>場が流れても続く。<b>もう一度革命が起きると元に戻る</b>(革命返し)</li>
      <li>革命中に11バックが起きると、逆転どうしが打ち消して<b>通常の強さ</b>に戻る(場が流れるまで)</li>
      <li>階段は一番小さい数字で比べる:革命中は ${cs('S8', 'S9', 'ST', 'SJ')} の次に ${cs('H7', 'H8', 'H9', 'HT')} が出せる</li>
    </ul>
  </div>
</section>

<section id="r-order" class="rule-sec">
  <h3>効果が重なったときの順番</h3>
  <ol class="order-list">
    <li><span>革命</span></li>
    <li><span>11バック(階段以外)</span></li>
    <li><span>7渡し(渡すカードを選ぶ)</span></li>
    <li><span>10捨て(捨てるカードを選ぶ)</span></li>
    <li><span>12ボンバー(数字を指定)</span></li>
    <li><span>8切り → 場が流れて出した人から(<b>5スキップは起きない</b>)</span></li>
    <li><span>5スキップ(8切りがないときだけ)</span></li>
  </ol>
  <div class="rule-card">
    <h4>例:${cs('S9', 'ST', 'SJ', 'SQ')} を出すと</h4>
    <p>革命が起き → 10捨てで1枚捨て → 12ボンバーで数字を1つ指定。<br>階段の中のJなので11バックは起きません。</p>
  </div>
</section>

<section id="r-joker" class="rule-sec">
  <h3>ジョーカー(1枚)</h3>
  <ul class="point-list">
    <li><b>単体では最強</b>。革命中も最強。勝てるのは ${c('S3')} だけ(スペ3返し)</li>
    <li>ペアや階段では<b>どのカードの代わりにも</b>なれる</li>
    <li>代わりにした数字の<b>効果も発動</b>(例:${cs('S9')}+JOKER+${cs('SJ')} でJOKERを10にすると10捨て)</li>
    <li>マーク縛り中は、縛りのマークとして使える</li>
    <li>12ボンバーで「ジョーカー」を指定すると、持っている人の手札から消える</li>
  </ul>
</section>

<section id="r-other" class="rule-sec">
  <h3>その他の細かいルール</h3>
  <table class="rule-table">
    <tr><th>パス</th><td>回数の制限なし。場が空のとき(親)はパスできない</td></tr>
    <tr><th>場が流れる</th><td>最後に出した人以外が続けてパス → 最後に出した人から。その人が上がっていたら次の人から</td></tr>
    <tr><th>5スキップ</th><td>上がった人は数えない。パスした人は数える。一周して自分に戻ったら場が流れる</td></tr>
    <tr><th>7渡しの相手</th><td>次の人が上がっていたら、さらに次のまだ上がっていない人</td></tr>
    <tr><th>12ボンバー</th><td>誰も持っていない数字も指定できる。同時に何人も上がったら、出した人から手番の順に順位を付ける</td></tr>
    <tr><th>階段のつながり</th><td>3から2まで。${cs('SK', 'SA', 'S2')} は○、${cs('SA', 'S2', 'S3')} は×</td></tr>
    <tr><th>同じ数字</th><td>2〜4枚まで(4枚+ジョーカーの5枚は出せない)</td></tr>
    <tr><th>都落ち</th><td>前回の大富豪が1位を逃したら、その場で大貧民として抜ける</td></tr>
    <tr><th>反則上がり</th><td>なし(どのカードで上がってもOK)</td></tr>
  </table>
</section>

<section id="r-match" class="rule-sec">
  <h3>連戦・カード交換・ポイント</h3>
  <table class="rule-table">
    <tr><th>称号</th><td>2人:大富豪/大貧民 ・ 3人:大富豪/平民/大貧民 ・ 4人:大富豪/富豪/貧民/大貧民 ・ 5人以上:中間はすべて平民</td></tr>
    <tr><th>カード交換</th><td>次のゲームの配札後に、大貧民→大富豪へ<b>最強の2枚</b>、貧民→富豪へ<b>最強の1枚</b>(自動)。受け取った側は同じ枚数を選んで返す</td></tr>
    <tr><th>最初の手番</th><td>1ゲーム目はダイヤの3を持つ人、2ゲーム目以降は大貧民</td></tr>
    <tr><th>ポイント</th><td>大富豪 +2 ・ 富豪 +1 ・ 平民 0 ・ 貧民 −1 ・ 大貧民 −2(部屋を閉じるまで累計)</td></tr>
  </table>
</section>

<section id="r-basic" class="rule-sec">
  <details>
    <summary><h3>基本ルール</h3></summary>
    <p class="note">大富豪を知っている人は読まなくてOKです。</p>
    <ul>
      <li>52枚+ジョーカー1枚を全員に配り切る(2人のときは各20枚)。手札が先になくなった人から上がり</li>
      <li>強さ:3 &lt; 4 &lt; … &lt; K &lt; A &lt; 2 &lt; ジョーカー</li>
      <li>場と<b>同じ枚数・同じ形</b>で、<b>より強い</b>カードを出すかパス</li>
      <li>出せる形:1枚、同じ数字2〜4枚、3枚以上の階段(連続した数字)</li>
      <li>階段は一番小さい数字で比べる(5-6-7 の次は 6-7-8 以上)</li>
      <li>残り1人になったらゲーム終了</li>
    </ul>
  </details>
</section>`;
