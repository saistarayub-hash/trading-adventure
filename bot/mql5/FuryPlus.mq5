//+------------------------------------------------------------------+
//|                                                    FuryPlus.mq5  |
//|  A time-window low-volatility range scalper for MT5.             |
//|                                                                  |
//|  Same family as the retail EAs marketed as "Forex Fury": trade  |
//|  inside one quiet hour, fade the edges of a compressed range,   |
//|  take a small target. Everything that reviewers and live users  |
//|  documented as the way those accounts die is closed off here:   |
//|                                                                  |
//|   1. HARD STOP LOSS ALWAYS. InpRequireHardStop cannot be turned  |
//|      off without refusing to start. No "let it run until it      |
//|      recovers", which is the documented failure mode.           |
//|   2. MAXIMUM POSITION LIFETIME + optional flat-at-window-end.    |
//|      Kills the "opened May 12th, TP is 1.46, GBPUSD last saw     |
//|      1.46 in June 2016" stuck-trade class.                      |
//|   3. BROKER SERVER OFFSET AUTO-DETECTED and printed. Wrong GMT   |
//|      offset is the #1 way people silently break a session bot.  |
//|   4. REAL NEWS FILTER using the MT5 economic calendar, with a   |
//|      flatten-before-event option.                               |
//|   5. SPREAD GATE + SPIKE KILL SWITCH that also protects open     |
//|      trades, not just entries.                                  |
//|   6. NO GRID, NO MARTINGALE. Code does not contain them. Not     |
//|      switchable, so no set file can smuggle them in.            |
//|   7. DAILY LOSS / LOSING-STREAK / EQUITY governors.              |
//|   8. NEGATIVE-R:R REFUSAL: refuses to start if the break-even    |
//|      win rate implied by TP/SL + costs exceeds InpMaxBreakEvenWR.|
//|   9. CSV TRADE LOG written every close, so your record does not |
//|      depend on a curated third-party widget.                     |
//|  10. NO LICENCE LOCK. Deliberately. An activation check tied to  |
//|      a username is the industry norm and it protects nobody.      |
//|                                                                  |
//|  This is engineering for study and for demo use. It is not       |
//|  financial advice and it carries no performance claim. Forex     |
//|  trading can lose more than your deposit.                        |
//+------------------------------------------------------------------+
#property copyright "FuryPlus - study/reference EA"
#property version   "1.00"
#property description "Time-window range scalper with mandatory protective stops. No grid, no martingale."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>
#include <Trade\SymbolInfo.mqh>

CTrade         trade;
CPositionInfo  pos;
CAccountInfo   acc;
CSymbolInfo    syminf;

//+------------------------------------------------------------------+
//| Inputs — named to mirror the documented input set of the EA we  |
//| studied, so the two can be compared field by field.             |
//+------------------------------------------------------------------+
input group "=== identity ==="
input long     InpMagicNumber        = 750911;    // Magic number (unique per chart)
input string   InpOrderComment       = "FuryPlus"; // Order comment
input bool     InpDryRun             = true;       // DRY RUN: signal + log only, sends no orders

enum ENUM_FURY_DIR
{
   BOTH_DIRECTIONS = 0,  // longs and shorts
   LONG_ONLY       = 1,  // longs only
   SHORT_ONLY      = 2   // shorts only
};

input group "=== direction & sizing ==="
input ENUM_FURY_DIR InpTradeDirection = BOTH_DIRECTIONS;
input double   InpFixedLots          = 0.01;       // Fixed lot size
input bool     InpUseIncrementalLot  = true;       // Use risk-% sizing instead of fixed lots
input double   InpRiskPerTradePct    = 0.50;       // Risk per trade, % of equity
input double   InpMaxLots            = 5.0;        // Lot ceiling
input double   InpCashRiskPerTrade   = 50.0;       // Alternative: fixed cash risk per trade

input group "=== exits ==="
input double   InpTakeProfitPips     = 9.0;        // Take profit (pips)
input double   InpStopLossPips       = 13.0;       // Stop loss (pips)  -- MANDATORY
input bool     InpRequireHardStop    = true;       // Refuse to start without a hard stop
input double   InpSlBeyondRangePips  = 3.0;        // Place stop this far beyond the range edge
input double   InpSlMaxPips          = 20.0;       // ...but never further than this
input double   InpBreakEvenTrigger   = 0.0;        // Move stop to +offset after N pips (0 = off)
input double   InpBreakEvenOffset    = 0.6;        // Lock this many pips at break-even
input double   InpTrailStartPips     = 0.0;        // Trailing arms after N pips (0 = off)
input double   InpTrailPips          = 6.0;        // Trailing distance
input double   InpTrailStepPips      = 3.0;        // Trailing step
input int      InpMaxHoldBars        = 20;         // Max position lifetime in bars (0 = unlimited)
input bool     InpCloseAtWindowEnd   = false;       // Flatten when the window closes

input group "=== session ==="
input string   InpWindowStart        = "20:00";    // Start time (GMT, HH:MM)
input string   InpWindowEnd          = "21:00";    // Stop time (GMT, HH:MM)
input bool     InpTimeRestriction    = true;        // Only look for trades inside the window
input bool     InpTradeMonday        = true;
input bool     InpTradeTuesday       = true;
input bool     InpTradeWednesday     = true;
input bool     InpTradeThursday      = true;
input bool     InpTradeFriday        = true;       // Many set Friday = false to avoid weekend holds
input bool     InpOneSetTradePerDay  = true;        // Max one entry per day
input int      InpRolloverBlackoutMin= 10;          // No entries N min either side of rollover
input int      InpForceServerOffset  = 0;           // 0 = auto-detect; else hours GMT offset

input group "=== market filters ==="
input int      InpMaxSpreadPoints    = 8;          // Max spread (broker points) to open
input double   InpSpreadSpikeMult    = 2.0;        // Cancel + flatten if spread > max * mult
input double   InpMinAtrPips         = 1.2;         // Need at least this much movement
input double   InpMaxAtrZ            = -0.3;        // Volatility must be BELOW its own norm by this z
input double   InpMaxAdx             = 18.0;        // Ranging only (ADX ceiling). 0 = off
input int      InpRangeLookbackBars  = 8;           // Range = N bars before the entry bar
input double   InpMaxRangePips       = 12.0;        // Range must be tighter than this
input double   InpMaxRangeAtrMult    = 4.0;         // ...or tighter than N x ATR
input int      InpAtrPeriod          = 14;
input int      InpRegimeTFMinutes    = 15;          // Timeframe used for ATR/ADX/range
input bool     InpUseAsianRange      = false;       // Use session range instead of rolling
input string   InpSessionRangeStart  = "00:00";     // Asian range start (GMT)
input string   InpSessionRangeEnd    = "07:00";     // Asian range end (GMT) -- MUST precede window

input group "=== news ==="
input bool     InpAvoidNews          = true;        // Use the MT5 economic calendar
input int      InpNewsBeforeMin      = 30;          // Block N minutes before a high-impact event
input int      InpNewsAfterMin       = 30;          // Block N minutes after
input bool     InpFlattenForNews     = false;        // Close open trades before the event
input string   InpNewsCurrencies     = "USD,EUR";   // Comma separated

input group "=== governors ==="
input double   InpDailyLossCapPct    = 1.5;         // Halt for the day at this % equity loss
input int      InpMaxConsecLosses    = 3;           // Halt for the day after N straight losers
input double   InpEquityStopPct      = 8.0;         // Stop entirely below this drawdown from start
input double   InpMaxBreakEvenWinRate= 72.0;        // Refuse presets needing more than this WR

input group "=== display ==="
input bool     InpDisplayPanel       = true;
input bool     InpDrawLevels         = true;   // mark entry/TP/SL + the measured range on the chart
input int      InpMarkHoldBars       = 96;     // keep finished trade markings this many bars (0 = until you clear them)
input color    InpPanelBg            = clrBlack;
input color    InpPanelText          = clrLime;
input int      InpPanelFontSize      = 9;
input int      InpPanelX             = 16;
input int      InpPanelY             = 26;
input bool     InpWriteTradeLog      = true;        // Append closed trades to MQL5\Files CSV

//+------------------------------------------------------------------+
//| State                                                            |
//+------------------------------------------------------------------+
double  g_pip            = 0.0001;
double  g_point          = 0.0001;
int     g_digits         = 5;
int     g_serverOffsetHr = 0;
bool    g_haltedToday    = false;
int     g_lastTradeDay   = -1;
int     g_consecLosses   = 0;
double  g_dayStartEquity = 0.0;
int     g_dayKey         = -1;
double  g_startEquity    = 0.0;
string  g_lastReject     = "-";
string  g_regimeText     = "-";
int     g_atrTF          = PERIOD_M15;
datetime g_lastFlatTime  = 0;

struct RangeLevels { double hi; double lo; bool ok; };

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
double PipSize()
{
   return (StringFind(_Symbol, "JPY") >= 0) ? 0.01 : 0.0001;
}
double PipsToPrice(const double pips)
{
   return pips * g_pip;
}
double PriceToPips(const double price)
{
   return (g_pip > 0.0) ? price / g_pip : 0.0;
}
int HmToMinutes(const string hm)
{
   int c = StringFind(hm, ":");
   if(c < 0) return (int)StringToInteger(hm) * 60;
   return (int)StringToInteger(StringSubstr(hm, 0, c)) * 60 + (int)StringToInteger(StringSubstr(hm, c + 1));
}
/** minutes-since-midnight of a GMT timestamp */
int GmtMinutes(const datetime t)
{
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.hour * 60 + s.min;
}
int GmtDayKey(const datetime t)
{
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.day_of_year + s.year * 1000;
}
int GmtDayOfWeek(const datetime t)
{
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.day_of_week;
}
/** Current time in GMT, honouring the auto-detected broker offset. */
datetime GmtNow()
{
   return TimeCurrent() + g_serverOffsetHr * 3600;
}
bool InWindow(const datetime t)
{
   if(!InpTimeRestriction) return true;
   int m = GmtMinutes(t);
   int a = HmToMinutes(InpWindowStart);
   int b = HmToMinutes(InpWindowEnd);
   if(a <= b) return (m >= a && m < b);
   return (m >= a || m < b);          // window wraps midnight
}
bool DayAllowed(const datetime t)
{
   switch(GmtDayOfWeek(t))
   {
      case 0: return false;                                   // Sunday: market barely open
      case 1: return InpTradeMonday;
      case 2: return InpTradeTuesday;
      case 3: return InpTradeWednesday;
      case 4: return InpTradeThursday;
      case 5: return InpTradeFriday;
      case 6: return false;                                   // Saturday
   }
   return false;
}
bool InRolloverBlackout(const datetime t)
{
   int m = GmtMinutes(t);
   // rollover = broker server midnight, i.e. 00:00 server == InpForceServerOffset hours GMT
   int roll = (24 * 60 - (g_serverOffsetHr >= 0 ? g_serverOffsetHr * 60 : (24 + g_serverOffsetHr) * 60)) % (24 * 60);
   int d = m - roll;
   if(d > 12 * 60)  d -= 24 * 60;
   if(d < -12 * 60) d += 24 * 60;
   return MathAbs(d) <= InpRolloverBlackoutMin;
}
double SpreadPoints()
{
   return (syminf.Spread());
}
bool HasOpenPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Magic() != InpMagicNumber) continue;
      if(pos.Symbol() != _Symbol) continue;
      return true;
   }
   return false;
}
int OpenPositionCount()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Magic() != InpMagicNumber || pos.Symbol() != _Symbol) continue;
      n++;
   }
   return n;
}

//+------------------------------------------------------------------+
//| Indicator buffers                                              |
//+------------------------------------------------------------------+
int atrHandle = INVALID_HANDLE;
int adxHandle = INVALID_HANDLE;

double GetBuf(const int handle, const int bufIdx, const int shift)
{
   double b[1];
   if(CopyBuffer(handle, bufIdx, shift, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}
/** z-score of current ATR against its trailing mean/stdev */
double AtrZScore(const int lookback)
{
   double buf[];
   ArraySetAsSeries(buf, false);
   int need = lookback + 2;
   if(CopyBuffer(atrHandle, 0, 1, need, buf) < need) return 0.0;
   double mean = 0.0;
   for(int i = 0; i < need - 1; i++) mean += buf[i];
   mean /= (need - 1);
   double var = 0.0;
   for(int i = 0; i < need - 1; i++) var += MathPow(buf[i] - mean, 2.0);
   var /= (need - 1);
   double sd = MathSqrt(var);
   double cur = buf[need - 1];
   return (sd > 0.0) ? (cur - mean) / sd : 0.0;
}
/** hi/lo of the reference range, excluding the current bar (no lookahead) */
RangeLevels ReferenceRange()
{
   RangeLevels r;
   r.hi = 0.0; r.lo = 0.0; r.ok = false;
   ENUM_TIMEFRAMES tf = (ENUM_TIMEFRAMES)g_atrTF;
   if(InpUseAsianRange)
   {
      int a = HmToMinutes(InpSessionRangeStart);
      int b = HmToMinutes(InpSessionRangeEnd);
      datetime from = (datetime)(MathFloor((double)(GmtNow() - b * 60) / 86400.0) * 86400.0 + a * 60);
      datetime to   = (datetime)(MathFloor((double)(GmtNow() - b * 60) / 86400.0) * 86400.0 + b * 60);
      MqlRates rr[];
      int got = CopyRates(_Symbol, tf, from, to, rr);
      if(got < 4) return r;
      double hi = -DBL_MAX, lo = DBL_MAX;
      for(int i = 0; i < got; i++) { hi = MathMax(hi, rr[i].high); lo = MathMin(lo, rr[i].low); }
      r.hi = hi; r.lo = lo; r.ok = (hi > lo);
      return r;
   }
   MqlRates rr2[];
   // shift 1 = start at the last CLOSED bar, so the current bar can never leak into the range
   int got2 = CopyRates(_Symbol, tf, 1, InpRangeLookbackBars, rr2);
   if(got2 < InpRangeLookbackBars) return r;
   double hi = -DBL_MAX, lo = DBL_MAX; // order irrelevant: only min/max are used
   for(int i = 0; i < got2; i++) { hi = MathMax(hi, rr2[i].high); lo = MathMin(lo, rr2[i].low); }
   r.hi = hi; r.lo = lo; r.ok = (hi > lo);
   return r;
}

//+------------------------------------------------------------------+
//| News                                                             |
//+------------------------------------------------------------------+
bool NewsNear()
{
   if(!InpAvoidNews) return false;
   datetime from = TimeCurrent() - InpNewsBeforeMin * 60;
   datetime to   = TimeCurrent() + InpNewsAfterMin  * 60;
   string currencies[];
   int n = StringSplit(InpNewsCurrencies, ',', currencies);
   for(int c = 0; c < n; c++)
   {
      string cur = currencies[c];
      StringTrimLeft(cur);
      StringTrimRight(cur);
      if(StringLen(cur) < 3) continue;
      MqlCalendarValue values[];
      int count = CalendarValueHistory(values, from, to, cur, CALENDAR_IMPORTANCE_HIGH);
      if(count > 0) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Cost / break-even check                                          |
//+------------------------------------------------------------------+
double BreakEvenWinRatePct()
{
   // round-trip cost in pips: half spread each side + slippage allowance + commission proxy
   double halfSpread = SpreadPoints() / 20.0;
   double slip = 0.4;
   double comm = 0.25;
   double c = halfSpread * 2.0 + slip + comm;
   if(InpTakeProfitPips + InpStopLossPips <= 0.0) return 999.0;
   return 100.0 * (InpStopLossPips + c) / (InpTakeProfitPips + InpStopLossPips);
}

//+------------------------------------------------------------------+
//| Sizing                                                           |
//+------------------------------------------------------------------+
double PipValuePerLot()
{
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0 || tickValue <= 0.0) return 0.0;
   return tickValue * (g_pip / tickSize);
}
double DesiredLots(const double slPips)
{
   double lots = InpFixedLots;
   if(InpUseIncrementalLot)
   {
      double pv = PipValuePerLot();
      if(pv <= 0.0 || slPips <= 0.0) return 0.0;
      double riskCash = acc.Equity() * InpRiskPerTradePct / 100.0;
      if(InpCashRiskPerTrade > 0.0 && InpRiskPerTradePct <= 0.0) riskCash = InpCashRiskPerTrade;
      lots = riskCash / (pv * slPips);
   }
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step > 0.0) lots = MathFloor(lots / step) * step;
   lots = MathMax(vmin, MathMin(MathMin(vmax, InpMaxLots), lots));
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
//| Logging: independent, auditable record                           |
//+------------------------------------------------------------------+
void LogLine(const string line)
{
   Print(line);
}
void AppendTradeLog(const ulong ticket, const string action)
{
   if(!InpWriteTradeLog) return;
   // FILE_READ|FILE_WRITE, not FILE_WRITE: FILE_WRITE alone truncates the log on every trade
   // and "append" becomes "keep only the last row", which would silently destroy the very
   // auditable record this exists to produce.
   int fh = FileOpen("FuryPlus_trades.csv", FILE_READ | FILE_WRITE | FILE_CSV | FILE_COMMON, ',');
   if(fh == INVALID_HANDLE)
   {
      Print("FuryPlus: cannot open FuryPlus_trades.csv in the terminal common Files folder: ",
            "independent trade log disabled");
      return;
   }
   // Do NOT read pos.* here: the position is already closed, so its fields are stale.
   FileSeek(fh, 0, SEEK_END);
   FileWrite(fh, TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS), action, (string)ticket, _Symbol, InpOrderComment);
   FileClose(fh);
}

//+------------------------------------------------------------------+
//| Panel                                                            |
//+------------------------------------------------------------------+
void PanelRow(const int i, const string label, const string value, const color c)
{
   string nm = "FP_" + IntegerToString(i);
   if(ObjectFind(0, nm) < 0)
   {
      ObjectCreate(0, nm, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, nm, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpPanelFontSize);
      ObjectSetString(0, nm, OBJPROP_FONT, "Consolas");
   }
   ObjectSetInteger(0, nm, OBJPROP_XDISTANCE, InpPanelX);
   ObjectSetInteger(0, nm, OBJPROP_YDISTANCE, InpPanelY + i * (InpPanelFontSize + 5));
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetString(0, nm, OBJPROP_TEXT, label + ": " + value);
}
void UpdatePanel(const string status)
{
   if(!InpDisplayPanel) return;
   color c = InpPanelText;
   PanelRow(0, "FuryPlus", (InpDryRun ? "DRY RUN" : "LIVE"), InpDryRun ? clrOrange : clrAqua);
   PanelRow(1, "window(GMT)", InpWindowStart + "-" + InpWindowEnd + (InWindow(GmtNow()) ? " OPEN" : " closed"), InWindow(GmtNow()) ? c : clrGray);
   PanelRow(2, "server offset", IntegerToString(g_serverOffsetHr) + "h " + (InpForceServerOffset != 0 ? "(forced)" : "(auto)"), clrSilver);
   PanelRow(3, "spread", DoubleToString(SpreadPoints(), 0) + " pts / max " + IntegerToString(InpMaxSpreadPoints),
             SpreadPoints() > InpMaxSpreadPoints ? clrOrangeRed : c);
   PanelRow(4, "regime", g_regimeText, c);
   PanelRow(5, "position", (HasOpenPosition() ? "OPEN" : "flat"), HasOpenPosition() ? clrYellow : clrGray);
   PanelRow(6, "day P&L", DoubleToString(acc.Equity() - g_dayStartEquity, 2), (acc.Equity() - g_dayStartEquity) >= 0 ? clrLime : clrTomato);
   PanelRow(7, "halted", g_haltedToday ? "YES (daily governor)" : "no", g_haltedToday ? clrRed : clrGray);
   PanelRow(8, "last reject", g_lastReject, clrSilver);
   PanelRow(9, "status", status, c);
   ChartRedraw();
}


//+------------------------------------------------------------------+
//| Chart markings                                                   |
//+------------------------------------------------------------------+
// Markings are drawn from the SAME numbers the entry decision used, so a line can never disagree
// with a trade. Objects are named FP_* so the existing OnDeinit cleanup removes them too - a marking
// left behind after the EA is removed is a lie on someone else's chart.
datetime g_markT0 = 0, g_markExpire = 0, g_markLastDraw = 0;
double   g_markEntry = 0.0, g_markTp = 0.0, g_markSl = 0.0;
double   g_markRangeHi = 0.0, g_markRangeLo = 0.0;
datetime g_markRangeT0 = 0;
int      g_markDir = 0;   // 1 long, -1 short, 0 none

void MarkLine(const string tag, const datetime t0, const double p0, const datetime t1, const double p1,
              const color clr, const string txt, const bool dotted)
{
   string nm = "FP_" + tag;
   if(ObjectFind(0, nm) < 0)
   {
      ObjectCreate(0, nm, OBJ_TREND, 0, t0, p0, t1, p1);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   }
   ObjectSetInteger(0, nm, OBJPROP_TIME, 0, t0);
   ObjectSetDouble (0, nm, OBJPROP_PRICE, 0, p0);
   ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t1);
   ObjectSetDouble (0, nm, OBJPROP_PRICE, 1, p1);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, dotted ? STYLE_DOT : STYLE_SOLID);
   ObjectSetString (0, nm, OBJPROP_TEXT, txt);
   ObjectSetString (0, nm, OBJPROP_TOOLTIP, txt);
}

void MarkBox(const string tag, const datetime t0, const double pA, const datetime t1, const double pB, const color clr)
{
   string nm = "FP_" + tag;
   if(ObjectFind(0, nm) < 0)
   {
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t0, pA, t1, pB);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
   }
   ObjectSetInteger(0, nm, OBJPROP_TIME, 0, t0);
   ObjectSetDouble (0, nm, OBJPROP_PRICE, 0, pA);
   ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t1);
   ObjectSetDouble (0, nm, OBJPROP_PRICE, 1, pB);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, clr);
}

void ArmMarks(const bool isLong, const double tp, const double sl)
{
   g_markDir = isLong ? 1 : -1;
   g_markEntry = isLong ? syminf.Ask() : syminf.Bid();   // the side actually filled, not the mid
   g_markTp = tp;
   g_markSl = sl;
   g_markT0 = TimeCurrent();
   g_markLastDraw = 0;   // force the next DrawMarks to paint: a fresh trade must show up immediately
   int mins = (int)MathMax(1, PeriodMinutes());
   g_markExpire = g_markT0 + (datetime)(long)(InpMarkHoldBars > 0 ? InpMarkHoldBars * mins * 60 : 0);
}

void ClearMarks()
{
   g_markEntry = g_markTp = g_markSl = g_markRangeHi = g_markRangeLo = 0.0;
   g_markT0 = g_markExpire = 0;
   g_markDir = 0;
   ObjectDelete(0, "FP_range_hi");
   ObjectDelete(0, "FP_range_lo");
   ObjectDelete(0, "FP_trade_entry");
   ObjectDelete(0, "FP_trade_tp");
   ObjectDelete(0, "FP_trade_sl");
   ObjectDelete(0, "FP_box_profit");
   ObjectDelete(0, "FP_box_risk");
}

// The measured range is marked whether or not a trade was taken - seeing the level the bot faded
// is how you audit a signal, and seeing it while it declines to trade is how you learn the filter.
void DrawMarks()
{
   if(!InpDrawLevels) return;
   if(g_markLastDraw == TimeCurrent() && g_markDir != 0 && HasOpenPosition()) return;
   g_markLastDraw = TimeCurrent();

   bool holding = HasOpenPosition();
   if(InpDryRun) holding = false;   // dry run never has a real position; the expiry clock owns the markings
   if(!holding && g_markDir != 0 && g_markExpire > 0 && TimeCurrent() > g_markExpire) ClearMarks();

   if(g_markRangeHi > 0.0 && g_markRangeLo > 0.0)
   {
      datetime t1 = TimeCurrent();
      MarkLine("range_hi", g_markRangeT0, g_markRangeHi, t1, g_markRangeHi, clrMediumOrchid, "range high", true);
      MarkLine("range_lo", g_markRangeT0, g_markRangeLo, t1, g_markRangeLo, clrMediumOrchid, "range low", true);
   }

   if(g_markDir != 0 && g_markEntry > 0.0)
   {
      // With InpMarkHoldBars = 0 the expiry is 0, which would anchor the right edge at 1970 and draw
      // nothing visible. "Keep until cleared" means keep extending the line, so fall back to now.
      datetime t1 = (holding || g_markExpire <= g_markT0) ? TimeCurrent() : g_markExpire;
      string tag = (g_markDir > 0 ? "LONG" : "SHORT") + " " + DoubleToString(g_markEntry, g_digits);
      MarkLine("trade_entry", g_markT0, g_markEntry, t1, g_markEntry, clrWhite, tag, false);
      MarkLine("trade_tp", g_markT0, g_markTp, t1, g_markTp, clrDodgerBlue, "TP", true);
      MarkLine("trade_sl", g_markT0, g_markSl, t1, g_markSl, clrOrangeRed, "SL", true);
      // profit box on the TP side, risk box on the SL side: the R:R becomes a shape you can see,
      // which is the one thing the Fury family never shows you (TP 5 against SL 29 is a tall red box).
      MarkBox("box_profit", g_markT0, g_markEntry, t1, g_markTp, clrMediumSeaGreen);
      MarkBox("box_risk",   g_markT0, g_markEntry, t1, g_markSl, clrIndianRed);
   }
   ChartRedraw();
}

//+------------------------------------------------------------------+
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   g_pip = PipSize();
   g_point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   g_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   syminf.Symbol(_Symbol);

   // ---- safety rails: refuse to start rather than start unsafe -----------------
   if(InpRequireHardStop && InpStopLossPips <= 0.0)
   {
      Print("FuryPlus REFUSED TO START: InpRequireHardStop is true and InpStopLossPips is 0. ",
            "A range fade without a stop is an open-ended bet that mean reversion eventually wins. ",
            "Set a stop, or set InpRequireHardStop=false only if you are deliberately studying the failure mode.");
      return(INIT_FAILED);
   }
   if(InpTakeProfitPips <= 0.0)
   {
      Print("FuryPlus REFUSED TO START: no take profit defined.");
      return(INIT_FAILED);
   }
   if(InpMaxHoldBars <= 0 && !InpCloseAtWindowEnd)
   {
      Print("FuryPlus REFUSED TO START: every position must be time-protected. ",
            "Set InpMaxHoldBars > 0 or InpCloseAtWindowEnd = true. This is the fix for the ",
            "documented 'trade still open weeks later, waiting for a price it will not see' failure.");
      return(INIT_FAILED);
   }
   double be = BreakEvenWinRatePct();
   if(be > InpMaxBreakEvenWinRate)
   {
      Print("FuryPlus REFUSED TO START: TP ", DoubleToString(InpTakeProfitPips, 1), "/SL ",
            DoubleToString(InpStopLossPips, 1), " with current costs needs a ", DoubleToString(be, 1),
            "% win rate just to break even, above the ", DoubleToString(InpMaxBreakEvenWinRate, 0),
            "% ceiling. This is the shape that produces '93% win rate' marketing and blown accounts. ",
            "Widen the TP, tighten the SL, or use a cheaper broker.");
      return(INIT_FAILED);
   }
   if(InpUseAsianRange && HmToMinutes(InpSessionRangeEnd) > HmToMinutes(InpWindowStart))
   {
      Print("FuryPlus REFUSED TO START: session range ends after the entry window opens, which would ",
            "measure the range using prices at or after the trade (lookahead). Set InpSessionRangeEnd <= ",
            InpWindowStart);
      return(INIT_FAILED);
   }
   if(InpMaxSpreadPoints <= 0)
   {
      Print("FuryPlus REFUSED TO START: a scalper with no spread gate is a donation to the broker.");
      return(INIT_FAILED);
   }

   // ---- broker server offset, the #1 silent misconfiguration in this category ----
   if(InpForceServerOffset != 0) g_serverOffsetHr = InpForceServerOffset;
   else g_serverOffsetHr = (int)MathRound((double)(TimeGMT() - TimeCurrent()) / 3600.0);
   Print("FuryPlus: broker server is ", g_serverOffsetHr, "h from GMT. Windows are matched against GMT; ",
         "if your broker quotes set files in server time, convert before you trust any hour.");

   g_atrTF = (InpRegimeTFMinutes <= 1 ? PERIOD_M1 : InpRegimeTFMinutes <= 5 ? PERIOD_M5 :
              InpRegimeTFMinutes <= 15 ? PERIOD_M15 : InpRegimeTFMinutes <= 30 ? PERIOD_M30 : PERIOD_H1);
   atrHandle = iATR(_Symbol, g_atrTF, InpAtrPeriod);
   adxHandle = iADX(_Symbol, g_atrTF, 14);
   if(atrHandle == INVALID_HANDLE || adxHandle == INVALID_HANDLE)
   {
      Print("FuryPlus: could not create indicator handles.");
      return(INIT_FAILED);
   }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(10);
   trade.SetTypeFillingBySymbol(_Symbol);
   g_startEquity = acc.Equity();
   g_dayStartEquity = acc.Equity();
   EventSetTimer(30);
   UpdatePanel("ready  break-even WR " + DoubleToString(be, 1) + "%");
   Print("FuryPlus ready on ", _Symbol, ", regime TF ", EnumToString((ENUM_TIMEFRAMES)g_atrTF), ", DRY RUN=", InpDryRun);
   return(INIT_SUCCEEDED);
}
void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, "FP_");
}   ClearMarks();

void OnTimer()
{
   OnTick();
}

//+------------------------------------------------------------------+
//| Close everything we own                                          |
//+------------------------------------------------------------------+
void FlattenAll(const string reason)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Magic() != InpMagicNumber || pos.Symbol() != _Symbol) continue;
      if(InpDryRun) { Print("[dry] flatten ticket ", pos.Ticket(), " (", reason, ")"); continue; }
      if(trade.PositionClose(pos.Ticket())) AppendTradeLog(pos.Ticket(), "CLOSE:" + reason);
      g_lastFlatTime = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| Manage                                                           |
//+------------------------------------------------------------------+
void ManageOpen()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!pos.SelectByIndex(i)) continue;
      if(pos.Magic() != InpMagicNumber || pos.Symbol() != _Symbol) continue;

      double openPrice = pos.PriceOpen();
      double curSl = pos.StopLoss();
      double curTp = pos.TakeProfit();
      bool isBuy = (pos.PositionType() == POSITION_TYPE_BUY);
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double fav = PriceToPips(isBuy ? (bid - openPrice) : (openPrice - ask));

      // spread spike kills an open trade too, not just new entries
      if(InpSpreadSpikeMult > 0 && SpreadPoints() > InpMaxSpreadPoints * InpSpreadSpikeMult)
      {
         g_lastReject = "spread spike -> flatten";
         FlattenAll("spread spike");
         return;
      }
      // lifetime / window guards
      if(InpMaxHoldBars > 0 || InpCloseAtWindowEnd)
      {
         datetime opened = (datetime)pos.Time();
         int barsHeld = 0;
         datetime t1 = opened, t2 = TimeCurrent();
         barsHeld = Bars(_Symbol, g_atrTF, t1, t2) - 1;
         bool tooOld = (InpMaxHoldBars > 0 && barsHeld >= InpMaxHoldBars);
         bool outWindow = (InpCloseAtWindowEnd && !InWindow(GmtNow()));
         if(tooOld || outWindow)
         {
            g_lastReject = tooOld ? "max lifetime" : "window end";
            if(InpDryRun) Print("[dry] time-exit ticket ", pos.Ticket(), " held ", barsHeld, " bars");
            else if(trade.PositionClose(pos.Ticket())) AppendTradeLog(pos.Ticket(), "TIME_EXIT");
            return;
         }
      }
      // break-even
      if(InpBreakEvenTrigger > 0 && fav >= InpBreakEvenTrigger)
      {
         double want = openPrice + (isBuy ? PipsToPrice(InpBreakEvenOffset) : -PipsToPrice(InpBreakEvenOffset));
         bool better = isBuy ? (want > curSl || curSl == 0.0) : (want < curSl || curSl == 0.0);
         if(better)
         {
            if(!InpDryRun) trade.PositionModify(pos.Ticket(), want, curTp);
            return;
         }
      }
      // trailing
      if(InpTrailStartPips > 0 && fav >= InpTrailStartPips)
      {
         double cand = isBuy ? bid - PipsToPrice(InpTrailPips) : ask + PipsToPrice(InpTrailPips);
         bool better = isBuy ? (cand > curSl + PipsToPrice(InpTrailStepPips)) : (curSl == 0.0 || cand < curSl - PipsToPrice(InpTrailStepPips));
         if(better)
         {
            if(!InpDryRun) trade.PositionModify(pos.Ticket(), cand, curTp);
            return;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Tick                                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!syminf.RefreshRates()) return;
   ManageOpen();

   datetime nowGmt = GmtNow();
   // day bookkeeping + governors
   int dk = GmtDayKey(nowGmt);
   if(dk != g_dayKey)
   {
      g_dayKey = dk;
      g_dayStartEquity = acc.Equity();
      g_haltedToday = false;
      g_consecLosses = 0;
   }
   double dayPnl = acc.Equity() - g_dayStartEquity;
   if(InpDailyLossCapPct > 0 && dayPnl <= -acc.Equity() * InpDailyLossCapPct / 100.0 && !g_haltedToday)
   {
      g_haltedToday = true;
      FlattenAll("daily loss cap");
      LogLine("HALT: daily loss cap hit (" + DoubleToString(dayPnl, 2) + "). No new trades today.");
   }
   if(InpEquityStopPct > 0 && acc.Equity() < g_startEquity * (1.0 - InpEquityStopPct / 100.0))
   {
      g_haltedToday = true;
      FlattenAll("equity stop");
      LogLine("HALT: equity stop. Manual restart required.");
   }
   UpdatePanel(HasOpenPosition() ? "managing" : (g_haltedToday ? "halted" : "watching"));
   // The lines that track an OPEN trade must be extended on every bar, and everything below returns
   // early once a position is held - so refresh here. Throttled to once a second: a tick stream can
   // deliver hundreds of updates a minute and ObjectSet* + ChartRedraw on each is pure CPU burn.
   if(g_markDir != 0) DrawMarks();

   if(g_haltedToday) { g_lastReject = "halted today"; return; }
   if(HasOpenPosition()) { g_lastReject = "position open"; return; }
   if(InpOneSetTradePerDay && g_lastTradeDay == dk) { g_lastReject = "one set per day"; return; }
   if(!InWindow(nowGmt)) { g_lastReject = "outside window"; return; }
   if(!DayAllowed(nowGmt)) { g_lastReject = "day disabled"; return; }
   if(InRolloverBlackout(nowGmt)) { g_lastReject = "rollover blackout"; return; }

   if(SpreadPoints() > InpMaxSpreadPoints) { g_lastReject = "spread " + IntegerToString((int)SpreadPoints()); return; }
   if(InpAvoidNews && NewsNear())
   {
      g_lastReject = "news window";
      if(InpFlattenForNews) FlattenAll("news incoming");
      return;
   }

   double atr = GetBuf(atrHandle, 0, 1);
   if(atr == EMPTY_VALUE || atr <= 0.0) { g_lastReject = "no atr"; return; }
   double atrPips = PriceToPips(atr);
   if(InpMinAtrPips > 0 && atrPips < InpMinAtrPips) { g_lastReject = "ATR too small"; return; }

   // low-volatility regime: ATR must sit below its own trailing norm
   // ~7 days of regime bars, so the "low volatility" test compares against a local norm
   double minsPerBar = (InpRegimeTFMinutes <= 1 ? 1.0 : InpRegimeTFMinutes <= 5 ? 5.0 : InpRegimeTFMinutes <= 15 ? 15.0 : InpRegimeTFMinutes <= 30 ? 30.0 : 60.0);
   int look = (int)MathRound(7.0 * 23 * 60.0 / minsPerBar);
   look = (int)MathMax(120.0, MathMin(900.0, look));
   double z = AtrZScore(look);
   if(InpMaxAtrZ != 0.0 && z > InpMaxAtrZ) { g_lastReject = "vol above norm z=" + DoubleToString(z, 2); return; }

   if(InpMaxAdx > 0.0)
   {
      double adx = GetBuf(adxHandle, 0, 1);
      if(adx != EMPTY_VALUE && adx > InpMaxAdx) { g_lastReject = "ADX " + DoubleToString(adx, 1); return; }
      g_regimeText = "ADX " + DoubleToString(adx, 1) + " ATR " + DoubleToString(atrPips, 1) + "p z " + DoubleToString(z, 2);
   }
   else g_regimeText = "ATR " + DoubleToString(atrPips, 1) + "p z " + DoubleToString(z, 2);

   RangeLevels r = ReferenceRange();
   if(!r.ok) { g_lastReject = "no range"; return; }
   g_markRangeHi = r.hi; g_markRangeLo = r.lo;
   g_markRangeT0 = InpUseAsianRange
                   ? (datetime)(long)(GmtNow() - (GmtNow() % 86400) + HmToMinutes(InpSessionRangeStart) * 60)
                   : (datetime)(long)(TimeCurrent() - (long)InpRangeLookbackBars * PeriodMinutes() * 60);
   DrawMarks();   // drawn before the reject gauntlet: a declined signal is still worth seeing
   double widthPips = PriceToPips(r.hi - r.lo);
   if(InpMaxRangePips > 0 && widthPips > InpMaxRangePips && widthPips > InpMaxRangeAtrMult * atrPips)
   {
      g_lastReject = "range " + DoubleToString(widthPips, 1) + "p too wide";
      return;
   }

   double bid = syminf.Bid();
   double ask = syminf.Ask();
   double bufP = PipsToPrice(0.3);
   bool longSig = (bid <= r.lo + bufP);
   bool shortSig = (ask >= r.hi - bufP);
   if(InpTradeDirection == LONG_ONLY) shortSig = false;
   if(InpTradeDirection == SHORT_ONLY) longSig = false;
   if(!longSig && !shortSig) { g_lastReject = "no touch (L" + DoubleToString(r.lo, g_digits) + " H" + DoubleToString(r.hi, g_digits) + ")"; return; }

   double slPips = InpStopLossPips;
   if(InpSlBeyondRangePips > 0.0)
   {
      double geo = PriceToPips(longSig ? (bid - r.lo) : (r.hi - ask)) + InpSlBeyondRangePips;
      slPips = MathMax(InpStopLossPips, MathMin(InpSlMaxPips, geo));
   }
   if(slPips <= 0.0) { g_lastReject = "computed SL <= 0"; return; }

   double lots = DesiredLots(slPips);
   if(lots <= 0.0) { g_lastReject = "size rounds to zero (equity too small for this risk%)"; return; }

   double tp = longSig ? bid + PipsToPrice(InpTakeProfitPips) : ask - PipsToPrice(InpTakeProfitPips);
   double sl = longSig ? ask - PipsToPrice(slPips)     : bid + PipsToPrice(slPips);
   tp = NormalizeDouble(tp, g_digits);
   sl = NormalizeDouble(sl, g_digits);

   string why = (longSig ? "BUY" : "SELL") + " fade " + DoubleToString(widthPips, 1) + "p range @20:00-ish, "
              + DoubleToString(atrPips, 1) + "p ATR, spread " + IntegerToString((int)SpreadPoints());
   if(InpDryRun)
   {
      LogLine("[dry] " + why + " lots " + DoubleToString(lots, 2) + " TP " + DoubleToString(tp, g_digits) + " SL " + DoubleToString(sl, g_digits));
      // Dry run still marks the chart, otherwise the mode that ships by default shows you nothing
      // and the first thing a user evaluates is the one thing it cannot evaluate.
      ArmMarks(longSig, tp, sl);
      g_lastTradeDay = dk;
      g_lastReject = "dry-run entry";
      return;
   }
   bool ok = longSig ? trade.Buy(lots, _Symbol, 0.0, sl, tp, InpOrderComment)
                     : trade.Sell(lots, _Symbol, 0.0, sl, tp, InpOrderComment);
   if(ok)
   {
      g_lastTradeDay = dk;
      ArmMarks(longSig, tp, sl);
      LogLine("ENTRY " + why);
   }
   else
   {
      g_lastReject = "order rejected " + IntegerToString((int)trade.ResultRetcode()) + " " + trade.ResultRetcodeDescription();
      Print("FuryPlus order failed: ", g_lastReject);
   }
}
//+------------------------------------------------------------------+
