from datetime import date
from decimal import Decimal, InvalidOperation

def cents(value):
    try: n=Decimal(str(value))
    except InvalidOperation: raise ValueError('Valor inválido')
    if not n.is_finite() or n<=0 or n>Decimal('1000000000') or n.as_tuple().exponent < -2: raise ValueError('Valor inválido')
    return int(n*100)

def limit_report(rows, opened, year, annual=8100000):
    months=0 if opened.year>year else 13-opened.month if opened.year==year else 12
    cap=annual*months//12
    gross=sum(r['amount'] for r in rows if r['kind']=='sale' and date.fromisoformat(str(r['day'])).year==year and date.fromisoformat(str(r['day']))>=opened)
    status='sem atividade' if not cap else 'excesso superior a 20%' if gross*5>cap*6 else 'excesso' if gross>cap else 'limite atingido' if gross==cap else 'atenção' if gross*10>=cap*9 else 'monitorar' if gross*5>=cap*4 else 'normal'
    return dict(gross=gross,limit=cap,remaining=cap-gross,status=status)

def cash_report(rows, year, month):
    start=date(year,month,1); end=date(year+(month==12),month%12+1,1)
    opening=incoming=outgoing=0
    for r in rows:
        d=date.fromisoformat(str(r['day'])); k=r['kind']; a=r['amount']
        if k not in ('receipt','expense'): continue
        if d<start: opening+=a if k=='receipt' else -a
        elif d<end:
            if k=='receipt': incoming+=a
            else: outgoing+=a
    return dict(opening=opening,incoming=incoming,outgoing=outgoing,balance=opening+incoming-outgoing)
