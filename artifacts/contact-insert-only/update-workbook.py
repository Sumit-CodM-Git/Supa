from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'add-members','crud-family','process-csv-import','resident-profile-console','update-member','update-residents-profile'}
EXAMPLES=json.loads((ROOT/'artifacts/api-workbook-audit/full-examples.json').read_text())
STATE=json.loads((ROOT/'artifacts/contact-insert-only/status.json').read_text())
NOTE='Phone duplication is restricted only when INSERT creates a new SSP_Contact in the same society (trimmed phone comparison). Member/family creation and CSV import reuse an existing society contact by phone without overwriting its fields. Existing contact/profile updates do not run this duplicate-phone restriction. CSV rows with contact_id update that society contact directly. Other required fields, authorization and business rules still apply.'
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
            # Retain newer full profile-image examples for the console.
            req=cells.get('M' if first else 'K','') if ep=='resident-profile-console' else ex['requestCell']
            resp=cells.get('T' if first else 'R','') if ep=='resident-profile-console' else ex['responseCell']
            if ep=='add-members':
                reused=copy.deepcopy(ex['responses'][0][1])
                for member in reused['data']['memberCreated']: member['isNewContact']=False
                resp+='\n\nExisting contact reused (HTTP 200; JSONC):\n'+json.dumps(reused,indent=2)
            if NOTE not in resp: resp+='\n\n// '+NOTE
            desc=cells.get('K' if first else 'I','')
            marker=' Contact insert-only restriction: '
            desc=desc.split(marker)[0]+marker+NOTE
            audit=f'supabase/functions/{ep}/index.ts\nSource SHA-256: '+hashlib.sha256((ROOT/f'supabase/functions/{ep}/index.ts').read_bytes()).hexdigest()+'\nMigration: supabase/migrations/20261117190000_contact_phone_insert_only.sql\n'+STATE['status']+'\nLocal checks: member/family reuse, duplicate-phone updates, CSV insert/reuse/update/error cases and insert-only database tests. Full request/response examples preserved or refreshed. No live member/profile data retained from verification.'
            vals={('K' if first else 'I'):desc,('M' if first else 'K'):req,('T' if first else 'R'):resp,('S' if first else 'Q'):'2026-11-17',('U' if first else 'T'):audit}
            if first: vals['Q']=STATE['status']
            else:
                vals['N']=STATE['status']
                vals['O']='Deployed contact insert-only restriction; existing contact reuse/updates allowed.'
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            for _,obj in ex['requests']+ex['responses']:
                if obj is not None:json.loads(json.dumps(obj));validated+=1
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
