const express = require('express');
const cheerio = require('cheerio');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://fconline.nexon.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Referer': BASE + '/DataCenter/PlayerStat',
  'Origin': BASE,
  'X-Requested-With': 'XMLHttpRequest'
};
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req,res)=>res.json({ok:true,mode:'unofficial-public-datacenter-proxy',note:'Nexon may change or restrict this undocumented endpoint.'}));
function cleanText(v){ return (v||'').replace(/\s+/g,' ').trim(); }
function num(v){ const m=String(v||'').replace(/,/g,'').match(/\d+/); return m?Number(m[0]):0; }
function playerFromRow($,el){
  const row=$(el); const onclick=row.attr('onclick')||row.find('[onclick]').first().attr('onclick')||'';
  const m=onclick.match(/(?:val\(['"]|spid[=:]['"]?)(\d{5,})/i) || onclick.match(/(\d{6,})/);
  const spid=m?m[1]:'';
  const texts=row.find('td, .td, span, div').map((_,x)=>cleanText($(x).clone().children().remove().end().text())).get().filter(Boolean);
  const all=cleanText(row.text());
  const imgs=row.find('img'); let season=''; let img='';
  imgs.each((_,im)=>{const src=$(im).attr('src')||$(im).attr('data-src')||''; const alt=$(im).attr('alt')||''; if(!season&&alt)season=alt; if(!img&&src)img=src;});
  const nameNode=row.find('.name, .player_name, .name a, a').filter((_,x)=>cleanText($(x).text())).first();
  const name=cleanText(nameNode.text()) || texts.find(t=>/[가-힣A-Za-z]/.test(t)) || all.slice(0,30);
  const nums=all.match(/\d{1,3}/g)||[];
  const ovr=num(row.find('.ovr, .value, . 능력치').first().text()) || (nums.length?Number(nums[0]):0);
  const salary=num(row.find('.pay, .salary').text());
  return {spid,name,season,ovr,salary,raw:all, image:spid?`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${spid}.png`:img, actionImage:spid?`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${spid}.png`:''};
}
app.get('/api/players', async (req,res)=>{
  try {
    const q=cleanText(req.query.q).slice(0,40);
    const pos=cleanText(req.query.pos);
    const season=cleanText(req.query.season);
    const minOvr=Math.max(0,Math.min(200,num(req.query.minOvr)));
    const maxOvr=Math.max(minOvr,Math.min(200,num(req.query.maxOvr)||200));
    const form=new URLSearchParams({strPlayerName:q,strSeason:season,strPosition:pos,n4SalaryMin:'0',n4SalaryMax:'99',n4OvrMin:String(minOvr),n4OvrMax:String(maxOvr)});
    const upstream=await fetch(BASE+'/datacenter/PlayerList',{method:'POST',headers:{...HEADERS,'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:form.toString(),signal:AbortSignal.timeout(15000)});
    if(!upstream.ok) throw new Error(`Nexon response ${upstream.status}`);
    const html=await upstream.text(); const $=cheerio.load(html);
    let rows=$('div.tr'); if(!rows.length) rows=$('tr').filter((_,el)=>$(el).attr('onclick')||$(el).find('[onclick]').length);
    const players=[]; rows.each((_,el)=>{const p=playerFromRow($,el); if(p.spid && p.name) players.push(p);});
    const unique=[...new Map(players.map(p=>[p.spid,p])).values()].slice(0,100);
    res.json({ok:true,source:'Nexon Data Center (unofficial endpoint)',count:unique.length,players:unique,warning:'비공식·비문서화 경로입니다. 응답 형식 변경 시 검색이 중단될 수 있습니다.'});
  } catch(e){res.status(502).json({ok:false,error:'넥슨 데이터센터 연결 실패',detail:e.message,players:[],hint:'현재는 예시 선수 목록을 사용하거나 잠시 후 다시 시도하세요.'});}
});
app.get('/api/player/:spid', async (req,res)=>{
  try{
    const spid=String(req.params.spid).replace(/\D/g,''); if(!/^\d{6,}$/.test(spid)) return res.status(400).json({ok:false,error:'잘못된 선수 ID'});
    const payload=new URLSearchParams({spid,n1Strong:String(Math.max(1,Math.min(13,num(req.query.enhance)||1))),n1Grow:'0',n4TeamColorId:'0',n4TeamColorLv:'0',n1Change:'0',strPlayerImg:`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${spid}.png`,rd:'0'});
    const upstream=await fetch(BASE+'/datacenter/PlayerAbility',{method:'POST',headers:{...HEADERS,'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',Referer:`${BASE}/datacenter/PlayerInfo?spid=${spid}`},body:payload.toString(),signal:AbortSignal.timeout(15000)});
    if(!upstream.ok) throw new Error(`Nexon response ${upstream.status}`);
    const html=await upstream.text(); const $=cheerio.load(html); const stats={};
    $('.ability_wrap, .ability, .playerAbility, .content_ability').each((_,el)=>{const t=cleanText($(el).text()); const m=t.match(/^(.+?)\s*(\d{1,3})$/); if(m) stats[m[1]]=Number(m[2]);});
    const name=cleanText($('.nameWrap .name, .info_line.info_name .name').first().text());
    const season=cleanText($('.playerCardWrap img[alt]').first().attr('alt')||$('.season img[alt]').first().attr('alt'));
    const teamColors=$('.tdefault .selector_list ul li a.selector_item').map((_,el)=>cleanText($(el).text())).get().filter(x=>x&&!['소속 팀컬러','단일팀'].includes(x));
    const salary=num($('.playerCardInfoSide .pay span, .side_utils .pay_side').first().text());
    res.json({ok:true,spid,name,season,salary,stats,teamColors,image:`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${spid}.png`,actionImage:`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${spid}.png`,rawAvailable:!!html});
  }catch(e){res.status(502).json({ok:false,error:'선수 상세 조회 실패',detail:e.message});}
});
app.listen(PORT,()=>console.log(`RED DEVIL SQUAD LAB listening on ${PORT}`));
