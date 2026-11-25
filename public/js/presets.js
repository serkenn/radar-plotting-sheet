// Example problems. Observation rows are [time, true bearing, range].

const noAvoid = () => ({ on: false, time: '', mode: 'cpa', dist: '', side: 'auto' });
const target = (rows, avoid = noAvoid()) => ({
  obs: rows.map(([time, bearing, range]) => ({ time, bearing, range })),
  avoid,
});

export const PRESETS = [
  {
    id: 'crossing',
    name: '右舷前方から横切る船（変針・変速で CPA を 3 海里に）',
    own: { course: '040', speed: '15' },
    targets: [
      target(
        [
          ['1000', '085', '12'],
          ['1006', '083.5', '9'],
        ],
        { on: true, time: '1012', mode: 'cpa', dist: '3', side: 'auto' },
      ),
    ],
  },
  {
    id: 'starboard',
    name: '右舷を見せて来る船（アスペクトが G）',
    own: { course: '300', speed: '12' },
    targets: [
      target([
        ['1200', '249', '12'],
        ['1206', '250.5', '9.5'],
      ]),
    ],
  },
  {
    id: 'three-ships',
    name: '3 隻を同時にプロット（相対運動は同じでも真の動きは違う）',
    own: { course: '040', speed: '15' },
    targets: [
      target([
        ['1000', '015', '12'],
        ['1006', '016.5', '9'],
      ]),
      target([
        ['1000', '310', '12'],
        ['1006', '311.5', '9'],
      ]),
      target([
        ['1000', '105', '12'],
        ['1006', '106.5', '9'],
      ]),
    ],
  },
  {
    id: 'three-plots',
    name: '3 回観測（方位がほとんど変わらない）',
    own: { course: '220', speed: '9' },
    targets: [
      target([
        ['0330', '276', '12'],
        ['0336', '275.5', '11'],
        ['0342', '275', '10'],
      ]),
    ],
  },
  {
    id: 'slow-down',
    name: '10 分間隔・減速して船首方向 2.5 海里を通す',
    own: { course: '165', speed: '9' },
    targets: [
      target(
        [
          ['1600', '270', '12.0'],
          ['1610', '269', '10.5'],
          ['1620', '268', '9.0'],
        ],
        { on: true, time: '1630', mode: 'bow', dist: '2.5', side: 'auto' },
      ),
    ],
  },
  {
    id: 'collision',
    name: '衝突コース（方位が変わらず距離だけ縮まる）',
    own: { course: '000', speed: '10' },
    targets: [
      target(
        [
          ['1200', '090', '6'],
          ['1206', '090', '5'],
        ],
        { on: true, time: '1212', mode: 'cpa', dist: '2', side: 'auto' },
      ),
    ],
  },
];

export const emptyTarget = () => target([
  ['', '', ''],
  ['', '', ''],
]);
