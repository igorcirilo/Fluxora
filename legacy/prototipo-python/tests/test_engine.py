import unittest
from datetime import date
from engine import cents,limit_report,cash_report
class Engine(unittest.TestCase):
 def test_limits(self):
  r=[dict(kind='sale',day='2026-10-01',amount=2025000),dict(kind='receipt',day='2026-10-01',amount=2025000)]
  self.assertEqual(limit_report(r,date(2026,10,1),2026)['status'],'limite atingido')
  r[0]['amount']+=405001
  self.assertEqual(limit_report(r,date(2026,10,1),2026)['status'],'excesso superior a 20%')
 def test_cash(self):
  r=[dict(kind='receipt',day='2026-01-01',amount=1000),dict(kind='expense',day='2026-02-01',amount=300),dict(kind='sale',day='2026-02-01',amount=999)]
  self.assertEqual(cash_report(r,2026,2)['balance'],700)
 def test_money(self):
  self.assertEqual(cents('12.34'),1234)
  for x in ['NaN','-1','1.001','Infinity']:
   with self.assertRaises(ValueError): cents(x)
if __name__=='__main__': unittest.main()
