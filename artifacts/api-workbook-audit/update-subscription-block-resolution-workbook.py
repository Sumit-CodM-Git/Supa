from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
TARGETS = {
    (1, '20'): ('get-subscription-info', 'The myPlan summary now matches a user-owned active subscription with a missing block only when society, tower, and flat still match the resident profile. This prevents a valid plan from falling back to FREE because an old order omitted block.'),
    (1, '26'): ('verify-razorpay-payment', 'If Razorpay order notes omitted block, payment verification recovers it from the owner profile only when society, tower, and flat match the order. Subscription request/response fields are unchanged.'),
    (1, '27'): ('razorpay-webhook', 'If Razorpay order notes omitted block, webhook processing recovers it from the owner profile only when society, tower, and flat match the order. Subscription request/response fields are unchanged.'),
    (2, '5'): ('verify-otp', 'The returned subscriptionPlan uses the updated summary: an owner-matched active plan with a missing block is recognized only when society, tower, and flat match the user profile.'),
    (3, '29'): ('razorpay-webhook', 'If Razorpay order notes omitted block, webhook processing recovers it from the owner profile only when society, tower, and flat match the order. Subscription request/response fields are unchanged.'),
}

with zipfile.ZipFile(BOOK) as src:
    infos = src.infolist()
    original = {i.filename: src.read(i.filename) for i in infos}
    changed = {}
    shared = ET.fromstring(original['xl/sharedStrings.xml'])
    strings = [''.join(si.itertext()) for si in shared.findall('m:si', NS)]

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

    for (sheet_num, row_num), (endpoint, note) in TARGETS.items():
        part = f'xl/worksheets/sheet{sheet_num}.xml'
        xml = changed.get(part, original[part]).decode()
        root = ET.fromstring(xml)
        row = root.find(f"m:sheetData/m:row[@r='{row_num}']", NS)
        assert row is not None, (sheet_num, row_num)
        desc_col, response_col = ('K', 'T') if sheet_num == 1 else ('I', 'R')
        desc = text_of(row.find(f"m:c[@r='{desc_col}{row_num}']", NS))
        response = text_of(row.find(f"m:c[@r='{response_col}{row_num}']", NS))
        if note not in desc:
            desc += ' Subscription scope fix: ' + note
        response_note = '// Subscription scope fix: ' + note + '\n// JSONC examples and endpoint wrappers are unchanged.'
        if response_note not in response:
            response = response.rstrip() + '\n\n' + response_note

        source_file = ROOT / 'supabase/functions' / endpoint / 'index.ts'
        source_hash = hashlib.sha256(source_file.read_bytes()).hexdigest()
        helper_hash = hashlib.sha256((ROOT / 'supabase/functions/_shared/subscription-utils.ts').read_bytes()).hexdigest()
        migration = 'supabase/migrations/20261112180000_match_owned_subscription_when_block_missing.sql'
        audit = (f'supabase/functions/{endpoint}/index.ts\nSource SHA-256: {source_hash}\n'
                 f'Shared helper SHA-256: {helper_hash}\nMigration: {migration}\n'
                 'Deployed/applied to the linked project on 2026-11-12. Live get_my_subscription_summary RPC verified for the affected account; no payment was created or charged during this fix.')

        values = {
            desc_col: desc,
            response_col: response,
            ('S' if sheet_num == 1 else 'Q'): '2026-11-12',
            ('U' if sheet_num == 1 else 'T'): audit,
        }
        if sheet_num == 1:
            values['N'] = 'Source reviewed; affected account summary RPC verified after the scope fix.'
            values['O'] = 'Payment verification/webhook deployed; subscription summary migration applied.'
        elif endpoint == 'verify-otp':
            values['N'] = 'Summary RPC behavior updated and live verified; login flow not re-exercised.'
            values['O'] = 'Updated get_my_subscription_summary RPC applied; verify-otp response shape unchanged.'

        for col, value in values.items():
            xml = replace_cell(xml, f'{col}{row_num}', value)
        changed[part] = xml.encode()
        ET.fromstring(changed[part])

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
print('Workbook package/XML validated. Updated subscription scope rows:', sorted(TARGETS))
