const logo = "/romix-logo.png";

interface Props {
  size?: number;
  className?: string;
  active?: boolean;
  borderRadius?: string;
}

export default function LogoBadge({ size = 12, className = "", active = true, borderRadius }: Props) {
  const px = size * 4;
  const radius = borderRadius ?? `${Math.round(px * 0.22)}px`;
  return (
    <img
      src={logo}
      alt=""
      className={className}
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        opacity: active ? 1 : 0.55,
        objectFit: "cover",
      }}
    />
  );
}
