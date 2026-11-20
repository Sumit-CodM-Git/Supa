from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'verify-razorpay-payment','razorpay-webhook'}
exec((ROOT/'artifacts/subscription-payment-race/examples.py').read_text())
STATE=json.loads((ROOT/'artifacts/subscription-payment-race/status.json').read_text())
NOTE='Client verification and signed payment.captured webhooks share a service-only atomic database finalizer. Per-payment and per-flat transaction locks serialize callbacks; repeated callbacks return the existing subscription without duplicate payment rows or repeated renewal/upgrade date changes. Payment row, subscription mutation and provider link commit or roll back together. Immutable legacy NEW orders targeting an owner-matched FREE subscription become upgrades. Existing unlinked payment records may be reused; unrelated active paid subscriptions remain protected. Verification still checks signature, capture, order, amount and caller ownership before finalization. Calendar-month validity is applied in the database. API wrappers remain unchanged.'
with zipfile.ZipFile(BOOK) as src:
    infos=src.infolist()
    original={i.filename:src.read(i.filename) for i in infos}
    changed={}
    strings=[''.join(si.itertext()) for si in ET.fromstring(original['xl/sharedStrings.xml']).findall('m:si',NS)]
    def text_of(cell):
        if cell is None:
            return ''
        if cell.get('t') == 's':
            return strings[int(cell.find('m:v', NS).text)]
        inline = cell.find('m:is', NS)
        if inline is not None:
            return ''.join(inline.itertext())
        value = cell.find('m:v', NS)
        return value.text if value is not None else ''

    def replace_cell(xml, ref, value):
        assert len(value.encode('utf-16-le')) // 2 <= 32767, (ref, 'Excel cell limit')
        match = re.search(r'<c\b[^>]*\br="' + re.escape(ref) + r'"[^>]*(?:/>|>.*?</c>)', xml, re.S)
        if match:
            style = re.search(r'\bs="([^"]+)"', match.group())
            style_attr = f' s="{style.group(1)}"' if style else ''
            cell = f'<c r="{ref}"{style_attr} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
            return xml[:match.start()] + cell + xml[match.end():]
        row_num = re.search(r'\d+$', ref).group()
        row_match = re.search(r'<row\b[^>]*\br="' + row_num + r'"[^>]*>', xml)
        assert row_match, ref
        cell = f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
        return xml[:row_match.end()] + cell + xml[row_match.end():]



    matches=[]
    validated=0
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml'
        xml=original[part].decode()
        root=ET.fromstring(xml)
        for row in root.findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            ep=cells.get('G' if i==1 else 'E','')
            if ep not in EPS: continue
            r=row.get('r');first=i==1;ex=EXAMPLES[ep]
            req=ex['request'];resp=ex['response']
            if NOTE not in resp: resp+='\n\n// '+NOTE
            desc=cells.get('K' if first else 'I','')
            marker=' Atomic payment completion: '
            desc=desc.split(marker)[0]+marker+NOTE
            audit=f'supabase/functions/{ep}/index.ts\nSource SHA-256: '+hashlib.sha256((ROOT/f'supabase/functions/{ep}/index.ts').read_bytes()).hexdigest()+'\nMigration: supabase/migrations/20261117200000_atomic_subscription_payment.sql\n'+STATE['status']+'\nShared helper: supabase/functions/_shared/subscription-payment.ts. Local database tests cover replay, simultaneous submissions, FREE upgrades, renewal/upgrade once, orphan reuse, scope validation and rollback. Client/webhook handler integration passed. No new Razorpay payment or checkout initiated.'
            vals={('K' if first else 'I'):desc,('M' if first else 'K'):req,('T' if first else 'R'):resp,('S' if first else 'Q'):'2026-11-17',('U' if first else 'T'):audit}
            if first: vals['Q']=STATE['status']
            else:
                vals['N']=STATE['status']
                vals['O']=STATE['status']
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append((i,r,ep))
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS
    print('Updated endpoint rows:',matches,'; illustrative objects checked:',validated)
temp = BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED) as out:
    for info in infos:
        out.writestr(info, changed.get(info.filename, original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part, data in original.items():
        if part.endswith('.xml'):
            ET.fromstring(check.read(part))
        if part not in changed:
            assert check.read(part) == data, part
temp.replace(BOOK)
print('Workbook package/XML and cell limits validated; unrelated package parts byte-identical.')
