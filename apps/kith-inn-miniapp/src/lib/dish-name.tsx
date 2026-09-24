import { Text } from "@tarojs/components";

export function DishName({ name, className = "", selectable = false }: { name: string; className?: string; selectable?: boolean }) {
  const classes = `dish-label ${className}`;
  return process.env.TARO_ENV === "h5"
    ? <span className={classes} title={name}>{name}</span>
    : <Text className={classes} selectable={selectable}>{name}</Text>;
}
