import unittest
from datetime import datetime, timezone
from update_public_prices import binance_bars, yahoo_bars, validate_bars, mapping

class PriceTests(unittest.TestCase):
    def test_closed_crypto_only(self):
        self.assertEqual(len(binance_bars([[1735689600000,'2','3','1','2.5',0,1735775999999]],1735776001)),1)
        self.assertEqual(binance_bars([[1735689600000,'2','3','1','2.5',0,1735775999999]],1735690000),[])

    def test_bar_validation(self):
        b={'date':'2026-09-21','open':2,'high':3,'low':1,'close':2.5}
        self.assertEqual(validate_bars([b]),[b])
        for bad in [{**b,'close':4},{**b,'low':0},{**b,'open':float('nan')},{**b,'date':'2026-02-30'}]:
            with self.assertRaises(ValueError): validate_bars([bad])
        with self.assertRaises(ValueError): validate_bars([b,b])

    def test_yahoo_session_end_and_timezone(self):
        stamp=int(datetime(2026,9,21,13,30,tzinfo=timezone.utc).timestamp())
        close=stamp+int(6.5*3600)
        raw={'chart':{'result':[{'meta':{'symbol':'MSFT','instrumentType':'EQUITY','exchangeTimezoneName':'America/New_York','currentTradingPeriod':{'regular':{'end':close}}},'timestamp':[stamp],'indicators':{'quote':[{'open':[2],'high':[3],'low':[1],'close':[2.5]}]}}]}}
        self.assertEqual(yahoo_bars(raw,'MSFT',close-10)[0],[])
        self.assertEqual(yahoo_bars(raw,'MSFT',close+100)[0],[])
        self.assertEqual(yahoo_bars(raw,'MSFT',close+1201)[0][0]['date'],'2026-09-21')
        with self.assertRaises(ValueError): yahoo_bars(raw,'NVDA',close+1201)

    def test_ambiguous_names_are_not_guessed(self):
        for name in ['Spcx','Openai','Anthropic','美股纳指OTC','黄金Xau','国内人工智能ETF','circle']:
            self.assertIsNone(mapping(name))
        self.assertEqual(mapping('$Trump'),('binance','TRUMPUSDT'))
        self.assertEqual(mapping('Msft'),('yahoo','MSFT'))

if __name__=='__main__': unittest.main()
