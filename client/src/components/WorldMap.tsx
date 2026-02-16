import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { CallData } from "@shared/schema";

interface WorldMapProps {
  calls: CallData[];
}

const MAP_WIDTH = 960;
const MAP_HEIGHT = 500;

function latLngToXY(lat: number, lng: number): [number, number] {
  const x = ((lng + 180) / 360) * MAP_WIDTH;
  const y = ((90 - lat) / 180) * MAP_HEIGHT;
  return [x, y];
}

function createArcPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curveHeight = Math.min(dist * 0.3, 80);
  const cx = mx - (dy / dist) * curveHeight;
  const cy = my + (dx / dist) * curveHeight;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

function getSentimentColor(sentiment: CallData["sentiment"], isActive: boolean): string {
  if (isActive) return "#22c55e";
  switch (sentiment) {
    case "Happy":
      return "#22c55e";
    case "Angry":
      return "#ef4444";
    case "Normal":
      return "#3b82f6";
    default:
      return "#6366f1";
  }
}

const WORLD_PATH = `M153,68L161,67L173,69L177,74L172,82L165,87L157,87L152,82L147,78L146,73ZM240,52L255,50L265,51L270,53L272,60L264,65L253,67L245,62L238,56ZM383,90L397,87L410,89L418,95L416,105L405,112L392,113L384,107L378,99ZM520,65L535,62L548,64L555,70L552,80L540,86L528,85L521,78L515,72ZM136,145L144,138L152,130L161,127L171,127L183,130L193,137L204,140L215,141L223,144L229,149L225,157L219,163L218,173L222,183L218,192L210,198L197,200L186,196L175,191L167,185L162,177L155,171L148,163L141,158L137,152ZM248,120L258,117L270,118L280,123L288,131L292,142L289,152L283,160L274,165L265,167L257,165L248,160L242,152L238,142L240,132ZM333,145L345,140L358,138L370,142L378,150L382,160L379,170L371,178L360,182L348,180L338,174L331,165L327,155ZM440,115L455,112L468,113L478,120L484,130L483,142L476,150L466,155L454,154L445,148L438,139L435,128ZM565,105L578,102L592,105L600,113L605,125L601,135L592,142L580,144L570,140L562,132L558,120ZM80,210L90,202L102,198L114,200L125,207L130,218L128,228L120,235L108,238L97,235L88,227L82,218ZM193,225L208,220L222,221L232,228L238,240L234,252L224,260L212,262L200,258L192,248L188,237ZM305,200L320,197L335,200L345,210L350,225L346,238L335,247L322,248L310,242L303,230L300,216ZM430,195L445,192L458,195L468,204L472,218L468,230L458,238L445,240L434,234L428,222L425,208ZM560,190L575,187L588,190L598,200L602,215L598,228L587,237L574,238L563,232L557,218L555,203ZM80,310L95,305L110,308L120,318L125,332L120,345L108,353L94,354L82,348L76,335L75,320ZM195,335L210,330L225,333L235,342L240,355L236,368L225,375L212,376L200,370L194,358L192,345ZM310,310L325,305L340,308L352,318L356,333L352,346L340,355L326,356L314,348L308,335ZM435,305L450,300L465,303L475,312L480,326L476,340L465,348L450,350L438,344L432,330ZM560,300L575,295L590,298L600,308L605,322L600,336L588,344L574,345L562,338L556,324ZM150,400L165,395L180,398L190,408L195,422L190,436L178,444L164,445L152,438L146,424ZM270,415L285,410L300,413L310,422L315,436L310,450L298,458L284,458L272,452L266,438ZM400,400L415,395L430,398L440,408L445,424L440,438L428,446L414,446L402,440L396,426ZM530,405L545,400L560,403L570,413L575,428L570,442L558,450L544,450L532,444L526,430Z`;

export function WorldMap({ calls }: WorldMapProps) {
  const [animatedCalls, setAnimatedCalls] = useState<Set<string>>(new Set());
  const prevCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(calls.map((c) => c.id));
    const newIds = new Set<string>();
    currentIds.forEach((id) => {
      if (!prevCallIdsRef.current.has(id)) {
        newIds.add(id);
      }
    });
    if (newIds.size > 0) {
      setAnimatedCalls((prev) => new Set([...prev, ...newIds]));
      setTimeout(() => {
        setAnimatedCalls((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 2000);
    }
    prevCallIdsRef.current = currentIds;
  }, [calls]);

  const activeCalls = calls.filter((c) => c.status === "active");
  const recentCalls = calls.slice(0, 20);

  return (
    <Card
      className="relative overflow-hidden p-0"
      data-testid="world-map"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-background/0 to-background/80 z-10 pointer-events-none" />

      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="point-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="active-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="transparent" />

        <g opacity="0.12">
          <path d={WORLD_PATH} fill="currentColor" className="text-foreground" />
        </g>

        <g opacity="0.08">
          {Array.from({ length: 7 }, (_, i) => (
            <line
              key={`h-${i}`}
              x1={0}
              y1={(MAP_HEIGHT / 7) * (i + 1)}
              x2={MAP_WIDTH}
              y2={(MAP_HEIGHT / 7) * (i + 1)}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-foreground"
            />
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={`v-${i}`}
              x1={(MAP_WIDTH / 12) * (i + 1)}
              y1={0}
              x2={(MAP_WIDTH / 12) * (i + 1)}
              y2={MAP_HEIGHT}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-foreground"
            />
          ))}
        </g>

        {recentCalls.map((call) => {
          if (!call.from || !call.to) return null;
          const [x1, y1] = latLngToXY(call.from.lat, call.from.lng);
          const [x2, y2] = latLngToXY(call.to.lat, call.to.lng);
          const isActive = call.status === "active";
          const color = getSentimentColor(call.sentiment, isActive);
          const isNew = animatedCalls.has(call.id);

          return (
            <g key={call.id}>
              <path
                d={createArcPath(x1, y1, x2, y2)}
                fill="none"
                stroke={color}
                strokeWidth={isActive ? 2 : 1}
                opacity={isActive ? 0.8 : 0.4}
                filter={isActive ? "url(#glow)" : undefined}
              >
                {isNew && (
                  <animate
                    attributeName="stroke-dasharray"
                    from="0 1000"
                    to="1000 0"
                    dur="1.5s"
                    fill="freeze"
                  />
                )}
              </path>

              <circle
                cx={x1}
                cy={y1}
                r={isActive ? 4 : 3}
                fill={color}
                opacity={isActive ? 0.9 : 0.5}
              >
                {isActive && (
                  <animate
                    attributeName="r"
                    values="3;5;3"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              <circle
                cx={x2}
                cy={y2}
                r={isActive ? 4 : 3}
                fill={color}
                opacity={isActive ? 0.9 : 0.5}
              >
                {isActive && (
                  <animate
                    attributeName="r"
                    values="3;5;3"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>

              {isActive && (
                <>
                  <circle cx={x1} cy={y1} r="12" fill="url(#active-glow)">
                    <animate
                      attributeName="r"
                      values="8;14;8"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle cx={x2} cy={y2} r="12" fill="url(#active-glow)">
                    <animate
                      attributeName="r"
                      values="8;14;8"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-md px-2 py-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="tabular-nums font-medium">{activeCalls.length}</span>
          <span>active</span>
        </div>
      </div>
    </Card>
  );
}
