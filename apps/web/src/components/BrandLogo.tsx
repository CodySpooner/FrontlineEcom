import logo from '../assets/frontline-logo.png';

// The owner's logo: docs/reference/frontline-logo.png cropped to the art and scaled to twice the sidebar's width.
export function BrandLogo() {
  return <img src={logo} alt="Frontline Ecom" width={400} height={93} draggable={false} className="h-auto w-full select-none" />;
}
