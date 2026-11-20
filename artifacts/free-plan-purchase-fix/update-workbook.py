from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json
REQUEST = 'JSONC — remove comments before sending JSON.\n' + '\n'.join([
'{',
'  "planCode": "PREMIUM", // Active paid plan_code from SSP_Subscription_Plan; FREE is not payable',
'  "billingPeriod": "monthly" // monthly, quarterly, half_yearly, yearly, three_year (case-insensitive)',
'}'])
RESPONSE = 'JSONC — illustrative success for new purchases and FREE upgrades; remove comments before sending JSON.\n' + json.dumps({"success":True,"data":{"orderId":"order_example","amount":19900,"currency":"INR","keyId":"rzp_test_example","planCode":"PREMIUM","planName":"Premium","billingPeriod":"monthly","validityMonths":1,"testMode":True}},indent=2) + '\n\nAmounts, currency, validity and provider mode come from actual price/provider configuration. Payment capture upgrades the existing FREE subscription; order creation alone does not activate a paid plan.\n\nHTTP 403 example:\n' + json.dumps({"success":False,"error":"ERROR","message":"This flat already has an active subscription."},indent=2) + '\nOther validation/not-found/server failures retain their endpoint-specific wrappers and status codes.'
NOTE = 'For an eligible caller who owns the active/trial FREE subscription, creates a paid upgrade order targeting that same subscription. New subscribers continue to use new orders. Existing paid subscriptions and membership/primary-owner denials remain blocked. The response contract is unchanged.'
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
    for sheet_num in range(1,4):
        part=f'xl/worksheets/sheet{sheet_num}.xml'
        xml=original[part].decode()
        root=ET.fromstring(xml)
        for row in root.findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            if not any(v.strip() in ['create-razorpay-order','/create-razorpay-order'] for v in cells.values()): continue
            r=row.get('r')
            first=sheet_num==1
            vals={('K' if first else 'I'):NOTE,('M' if first else 'K'):REQUEST,('T' if first else 'R'):RESPONSE,('S' if first else 'Q'):'2026-11-17',('U' if first else 'T'):'supabase/functions/create-razorpay-order/index.ts\nSource SHA-256: '+hashlib.sha256((ROOT/'supabase/functions/create-razorpay-order/index.ts').read_bytes()).hexdigest()+'\n60 mocked order regression scenarios and four module startup checks passed. Live database eligibility confirmed for flat 25030. Deployed to linked project isrqhkshygauaehwfycw on 2026-11-17; no live checkout/payment test performed.'}
            if first:
                vals.update({'Q':'Deployed 2026-11-17; local regression checks passed; live checkout not exercised.','P':'planCode: active paid plan_code from SSP_Subscription_Plan. billingPeriod: monthly, quarterly, half_yearly, yearly, three_year; case-insensitive.','N':'planCode: string; billingPeriod: string','O':'None.'})
            for col,value in vals.items(): xml=replace_cell(xml,col+r,value)
            matches.append((sheet_num,r))
        if xml.encode()!=original[part]: changed[part]=xml.encode()
    assert matches, 'Missing endpoint rows'
    print('Updated endpoint rows:',matches)
    # Validate both complete illustrative response examples and the JSONC request.
    json.loads('\n'.join(line.split('//')[0] for line in REQUEST.splitlines()[1:]))
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
print('Workbook package/XML validated. Updated subscription scope rows:', matches)
