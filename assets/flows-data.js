(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowsData = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // Static research estimates compiled DEV SAMPLE; not market data. Money moves from
  // "from" (the customer) to "to" (the supplier). Amounts are USD billions for
  // calendar 2025 or the fiscal year that mostly overlaps it.
  // conf: 'disclosed' = reported for this counterparty; 'derived' = computed from
  // reported figures plus a stated assumption; 'estimated' = analyst or modelled.
  const meta = {
    period: 'Calendar 2025, or the fiscal year that mostly overlaps it',
    unit: 'USD billions',
    fx: 'USD/TWD 31.3 · USD/JPY 150 · USD/KRW 1,420 · USD/CNY 7.2 · EUR→USD 1.13 · CHF→USD 1.21 · GBP→USD 1.32',
    compiled: "DEV SAMPLE",
  };

  // Tier groups in money order. Four dashboard tiers are split by role because
  // they contain a customer→supplier step of their own. "tier" is the index in
  // the dashboard's TIERS list; "column" is the position left to right.
  const groups = [
    {id:"t10-brands", tier:9, tierLabel:"Tier 10", role:"Brands & hyperscalers", column:0, hex:"#C9538B",
      companies:["Apple","Alphabet (Google)","Microsoft","Amazon"]},
    {id:"t10-odm", tier:9, tierLabel:"Tier 10", role:"ODMs & server makers", column:1, hex:"#C9538B",
      companies:["Foxconn (Hon Hai)","Quanta Computer","Supermicro","Wistron","Inventec"]},
    {id:"t9", tier:8, tierLabel:"Tier 9", role:"Fabless designers", column:2, hex:"#DD5B5B",
      companies:["NVIDIA","Broadcom","AMD","Marvell Technology","Qualcomm","MediaTek","MosChip","Saankhya Labs"]},
    {id:"t6", tier:5, tierLabel:"Tier 6", role:"Foundries & IDMs", column:3, hex:"#E8B84B",
      companies:["TSMC","Samsung Electronics","SK Hynix","Micron Technology","Intel Corporation","SMIC","UMC (United Microelectronics)","Nanya Technology","GlobalFoundries","Hua Hong Semiconductor","Tower Semiconductor","Tata Electronics"]},
    {id:"t8-osat", tier:7, tierLabel:"Tier 8", role:"Assembly & test services", column:4, hex:"#E27B54",
      companies:["ASE Technology (incl. SPIL)","JCET Group","Amkor Technology","Tongfu Microelectronics (TFME)","ChipMOS Technologies","Powertech Technology (PTI)","King Yuan Electronics (KYEC)","Huatian Technology","Chipbond Technology","Hana Micron","SFA Semicon","Nepes Corporation","UTAC Group"]},
    {id:"t5", tier:4, tierLabel:"Tier 5", role:"EDA & IP", column:4, hex:"#A8C24E",
      companies:["Arm Holdings","Cadence Design Systems","Synopsys","Keysight Technologies","Rambus","CEVA","Siemens EDA (formerly Mentor)","Alphawave Semi","Zuken","Imagination Technologies","Altium"]},
    {id:"t7-sub", tier:6, tierLabel:"Tier 7", role:"Package substrates", column:5, hex:"#E89B4B",
      companies:["Samsung Electro-Mechanics (Semco)","Unimicron Technology","Kyocera Corporation","Nan Ya PCB","AT&S","Ibiden Co., Ltd.","Shinko Electric Industries","Kinsus Interconnect Tech.","Shennan Circuits","Zhen Ding Technology"]},
    {id:"t8-ate", tier:7, tierLabel:"Tier 8", role:"Test equipment", column:5, hex:"#E27B54",
      companies:["Advantest","Teradyne"]},
    {id:"t7-abf", tier:6, tierLabel:"Tier 7", role:"ABF film", column:6, hex:"#E89B4B",
      companies:["Ajinomoto Co., Inc."]},
    {id:"t4", tier:3, tierLabel:"Tier 4", role:"Fab equipment", column:6, hex:"#4FBF7A",
      companies:["ASML","Applied Materials","Lam Research","KLA Corporation","Tokyo Electron (TEL)","NAURA Technology Group","ASM International","Advanced Micro-Fabrication Equipment (AMEC)","Canon","SCREEN Holdings","Kokusai Electric","Nikon","Hitachi High-Tech","Plasma-Therm"]},
    {id:"t1", tier:0, tierLabel:"Tier 1", role:"Silicon wafers", column:6, hex:"#8B7FD8",
      companies:["SUMCO Corporation","GlobalWafers","Siltronic AG","Formosa SUMCO Technology","Shin-Etsu Handotai"]},
    {id:"t3", tier:2, tierLabel:"Tier 3", role:"Subsystems", column:7, hex:"#4FB8AE",
      companies:["MKS Instruments","VAT Group","Advanced Energy Industries","Ultra Clean Technology","Ichor Systems","Comet Group","Horiba","Ebara Corporation","NGK Insulators","Carl Zeiss SMT","TRUMPF","Edwards (Atlas Copco)"]},
    {id:"t2", tier:1, tierLabel:"Tier 2", role:"Chemicals & gases", column:7, hex:"#6AA6D8",
      companies:["Linde plc","Air Liquide","Shin-Etsu Chemical","Merck KGaA (Versum Materials)","Air Products and Chemicals","BASF SE","Entegris (incl. KMG Chemicals)","Taiyo Nippon Sanso","Avantor, Inc.","Solvay S.A.","Stella Chemifa","Kanto Chemical","Tokyo Ohka Kogyo (TOK)","Fujifilm Holdings","Dongjin Semichem","Resonac Holdings","JSR Corporation","SK Specialty"]},
    {id:"t0", tier:0, tierLabel:"Tier 0", role:"Polysilicon", column:7, hex:"#8B7FD8",
      companies:["Wacker Chemie","Tokuyama Corporation","OCI Company","Hemlock Semiconductor"]},
  ];

  // Display names for chart labels; tooltips and tables use the full name.
  const short = {
    "Alphabet (Google)":"Alphabet", "Foxconn (Hon Hai)":"Foxconn", "Quanta Computer":"Quanta",
    "Marvell Technology":"Marvell", "Micron Technology":"Micron", "Intel Corporation":"Intel",
    "UMC (United Microelectronics)":"UMC", "Nanya Technology":"Nanya", "Hua Hong Semiconductor":"Hua Hong",
    "Tower Semiconductor":"Tower", "ASE Technology (incl. SPIL)":"ASE (incl. SPIL)", "JCET Group":"JCET",
    "Amkor Technology":"Amkor", "Tongfu Microelectronics (TFME)":"TFME", "ChipMOS Technologies":"ChipMOS",
    "Powertech Technology (PTI)":"Powertech (PTI)", "King Yuan Electronics (KYEC)":"KYEC", "Huatian Technology":"Huatian",
    "Chipbond Technology":"Chipbond", "Nepes Corporation":"Nepes", "UTAC Group":"UTAC",
    "Arm Holdings":"Arm", "Cadence Design Systems":"Cadence", "Keysight Technologies":"Keysight",
    "Siemens EDA (formerly Mentor)":"Siemens EDA", "Imagination Technologies":"Imagination", "Samsung Electro-Mechanics (Semco)":"Samsung Electro-Mech.",
    "Unimicron Technology":"Unimicron", "Kyocera Corporation":"Kyocera", "Ibiden Co., Ltd.":"Ibiden",
    "Shinko Electric Industries":"Shinko", "Kinsus Interconnect Tech.":"Kinsus", "Zhen Ding Technology":"Zhen Ding",
    "Ajinomoto Co., Inc.":"Ajinomoto", "KLA Corporation":"KLA", "Tokyo Electron (TEL)":"Tokyo Electron",
    "NAURA Technology Group":"NAURA", "Advanced Micro-Fabrication Equipment (AMEC)":"AMEC", "SCREEN Holdings":"SCREEN",
    "Kokusai Electric":"Kokusai", "SUMCO Corporation":"SUMCO", "Siltronic AG":"Siltronic",
    "Formosa SUMCO Technology":"Formosa SUMCO", "MKS Instruments":"MKS", "VAT Group":"VAT",
    "Advanced Energy Industries":"Advanced Energy", "Ultra Clean Technology":"Ultra Clean", "Ichor Systems":"Ichor",
    "Comet Group":"Comet", "Ebara Corporation":"Ebara", "NGK Insulators":"NGK",
    "Carl Zeiss SMT":"Zeiss SMT", "Edwards (Atlas Copco)":"Edwards", "Linde plc":"Linde",
    "Merck KGaA (Versum Materials)":"Merck KGaA", "Air Products and Chemicals":"Air Products", "BASF SE":"BASF",
    "Entegris (incl. KMG Chemicals)":"Entegris", "Avantor, Inc.":"Avantor", "Solvay S.A.":"Solvay",
    "Tokyo Ohka Kogyo (TOK)":"TOK", "Fujifilm Holdings":"Fujifilm", "Resonac Holdings":"Resonac",
    "JSR Corporation":"JSR", "Wacker Chemie":"Wacker", "Tokuyama Corporation":"Tokuyama",
    "OCI Company":"OCI", "Hemlock Semiconductor":"Hemlock",
  };

  // 2025 revenue of the business that receives these flows (USD billions), used to
  // show how much of a company's revenue the tracked flows explain.
  const revenue = {
    "TSMC": {usd:122, basis:"sample"},
  };

  const flows = [
    {from:"Microsoft", to:"Foxconn (Hon Hai)", usd:30, conf:"estimated", what:"AI racks",
      basis:"sample",
      sources:[]},
    {from:"Amazon", to:"Quanta Computer", usd:20, conf:"estimated", what:"Servers",
      basis:"sample",
      sources:[]},
    {from:"Apple", to:"TSMC", usd:20.6, conf:"disclosed", what:"Wafers",
      basis:"sample",
      sources:[{title:"TSMC AR", url:"https://investor.tsmc.com/"}]},
    {from:"Apple", to:"Foxconn (Hon Hai)", usd:80, conf:"estimated", what:"iPhone assembly",
      basis:"sample",
      sources:[]},
    {from:"Foxconn (Hon Hai)", to:"NVIDIA", usd:40, conf:"derived", what:"GPUs",
      basis:"sample",
      sources:[]},
    {from:"Quanta Computer", to:"NVIDIA", usd:25, conf:"derived", what:"GPUs",
      basis:"sample",
      sources:[]},
    {from:"Microsoft", to:"AMD", usd:5, conf:"estimated", what:"GPUs",
      basis:"sample",
      sources:[]},
    {from:"NVIDIA", to:"TSMC", usd:23.2, conf:"disclosed", what:"Wafers and CoWoS",
      basis:"sample",
      sources:[]},
    {from:"NVIDIA", to:"SK Hynix", usd:20, conf:"estimated", what:"HBM",
      basis:"sample",
      sources:[]},
    {from:"AMD", to:"TSMC", usd:8, conf:"estimated", what:"Wafers",
      basis:"sample",
      sources:[]},
    {from:"NVIDIA", to:"Wistron", usd:3, conf:"estimated", what:"Board assembly",
      basis:"sample",
      sources:[]},
    {from:"Samsung Electronics", to:"Qualcomm", usd:5, conf:"estimated", what:"Snapdragon",
      basis:"sample",
      sources:[]},
    {from:"Intel Corporation", to:"TSMC", usd:6, conf:"estimated", what:"Tiles",
      basis:"sample",
      sources:[]},
    {from:"TSMC", to:"ASML", usd:10, conf:"derived", what:"Lithography",
      basis:"sample",
      sources:[]},
    {from:"TSMC", to:"Applied Materials", usd:7, conf:"derived", what:"Deposition",
      basis:"sample",
      sources:[]},
    {from:"Samsung Electronics", to:"Lam Research", usd:4, conf:"derived", what:"Etch",
      basis:"sample",
      sources:[]},
    {from:"ASML", to:"Carl Zeiss SMT", usd:4, conf:"estimated", what:"Optics",
      basis:"sample",
      sources:[]},
    {from:"Applied Materials", to:"MKS Instruments", usd:0.8, conf:"estimated", what:"RF power",
      basis:"sample",
      sources:[]},
    {from:"TSMC", to:"Shin-Etsu Handotai", usd:1.5, conf:"estimated", what:"Wafers",
      basis:"sample",
      sources:[]},
    {from:"SUMCO Corporation", to:"Tokuyama Corporation", usd:0.2, conf:"estimated", what:"Poly",
      basis:"sample",
      sources:[]},
    {from:"TSMC", to:"Linde plc", usd:0.9, conf:"estimated", what:"Gases",
      basis:"sample",
      sources:[]},
    {from:"NVIDIA", to:"ASE Technology (incl. SPIL)", usd:1.2, conf:"estimated", what:"Packaging",
      basis:"sample",
      sources:[]},
    {from:"ASE Technology (incl. SPIL)", to:"Advantest", usd:0.5, conf:"estimated", what:"Testers",
      basis:"sample",
      sources:[]},
    {from:"ASE Technology (incl. SPIL)", to:"Unimicron Technology", usd:0.6, conf:"estimated", what:"Substrates",
      basis:"sample",
      sources:[]},
    {from:"Unimicron Technology", to:"Ajinomoto Co., Inc.", usd:0.3, conf:"estimated", what:"ABF film",
      basis:"sample",
      sources:[]},
    {from:"Qualcomm", to:"Arm Holdings", usd:0.6, conf:"estimated", what:"Royalties",
      basis:"sample",
      sources:[]},
    {from:"TSMC", to:"Advantest", usd:0.7, conf:"estimated", what:"Testers",
      basis:"sample",
      sources:[]},
  ];

  return {meta, groups, short, revenue, flows};
});
