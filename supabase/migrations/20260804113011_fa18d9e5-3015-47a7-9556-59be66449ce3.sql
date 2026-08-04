-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin','staff','customer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','staff'))
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own or staff" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "update own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- CATEGORIES
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories staff write" ON public.categories FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL UNIQUE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  metal text NOT NULL DEFAULT 'gold',
  purity text,
  weight_grams numeric(10,3) NOT NULL DEFAULT 0,
  stone_details text,
  making_charges_pct numeric(5,2) NOT NULL DEFAULT 0,
  base_price numeric(12,2) NOT NULL DEFAULT 0,
  image_url text,
  description text,
  in_stock boolean NOT NULL DEFAULT true,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products public read" ON public.products FOR SELECT USING (published = true);
CREATE POLICY "products staff read" ON public.products FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "products staff write" ON public.products FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ORDERS
CREATE TYPE public.order_status AS ENUM ('pending','confirmed','packed','shipped','delivered','cancelled');

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text,
  status public.order_status NOT NULL DEFAULT 'pending',
  payment_method text NOT NULL DEFAULT 'upi',
  total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders own read" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "orders staff write" ON public.orders FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order items read" ON public.order_items FOR SELECT TO authenticated USING (
  public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
);
CREATE POLICY "order items staff write" ON public.order_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- METAL RATES
CREATE TABLE public.metal_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metal text NOT NULL,
  purity text NOT NULL,
  rate_per_gram numeric(12,2) NOT NULL,
  rate_date date NOT NULL DEFAULT current_date,
  UNIQUE (metal, purity, rate_date)
);
GRANT SELECT ON public.metal_rates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metal_rates TO authenticated;
GRANT ALL ON public.metal_rates TO service_role;
ALTER TABLE public.metal_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rates public read" ON public.metal_rates FOR SELECT USING (true);
CREATE POLICY "rates staff write" ON public.metal_rates FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications read" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "notifications staff write" ON public.notifications FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- SEED
INSERT INTO public.categories (name, slug, sort_order) VALUES
 ('Gold Jewellery','gold-jewellery',1),
 ('Silver Jewellery','silver-jewellery',2),
 ('Diamond Jewellery','diamond-jewellery',3),
 ('Bridal Collection','bridal-collection',4),
 ('Rings','rings',5),
 ('Earrings','earrings',6),
 ('Necklaces','necklaces',7),
 ('Bangles','bangles',8),
 ('Chains','chains',9),
 ('Kids Jewellery','kids-jewellery',10);

INSERT INTO public.metal_rates (metal, purity, rate_per_gram) VALUES
 ('gold','24K',7480.00),
 ('gold','22K',6860.00),
 ('gold','18K',5610.00),
 ('silver','925',94.50);

INSERT INTO public.products (name, sku, category_id, metal, purity, weight_grams, stone_details, making_charges_pct, base_price, description)
SELECT v.name, v.sku, c.id, v.metal, v.purity, v.weight, v.stone, v.mc, v.price, v.descr
FROM (VALUES
 ('Kundan Bridal Necklace Set','RJ-BR-001','bridal-collection','gold','22K',48.500,'Uncut polki, pearls',14.0,398500.00,'Handcrafted bridal set with matching earrings.'),
 ('Classic Temple Necklace','RJ-NK-002','necklaces','gold','22K',32.250,'Ruby accents',12.5,242000.00,'South Indian temple design necklace.'),
 ('Solitaire Diamond Ring','RJ-RG-003','rings','gold','18K',4.100,'0.75ct VVS1 solitaire',10.0,189000.00,'Certified solitaire in a six-prong setting.'),
 ('Jhumka Pearl Earrings','RJ-ER-004','earrings','gold','22K',9.800,'Fresh water pearls',13.0,78600.00,'Traditional jhumkas with pearl drops.'),
 ('Antique Gold Bangles (Pair)','RJ-BG-005','bangles','gold','22K',44.000,NULL,11.0,336000.00,'Antique-finish pair of bangles.'),
 ('Rope Chain 20 inch','RJ-CH-006','chains','gold','22K',12.400,NULL,8.0,91500.00,'Everyday wear rope chain.'),
 ('Silver Anklet Pair','RJ-SL-007','silver-jewellery','silver','925',38.000,NULL,18.0,5400.00,'Oxidised silver anklets with ghungroo.'),
 ('Kids Gold Studs','RJ-KD-008','kids-jewellery','gold','18K',1.200,NULL,15.0,9800.00,'Lightweight screw-back studs for children.')
) AS v(name, sku, cat, metal, purity, weight, stone, mc, price, descr)
JOIN public.categories c ON c.slug = v.cat;

INSERT INTO public.orders (order_number, customer_name, customer_phone, status, payment_method, total) VALUES
 ('RJ2601','Ananya Sharma','+91 98200 11223','confirmed','upi',242000.00),
 ('RJ2602','Vikram Patel','+91 99870 44556','shipped','card',91500.00),
 ('RJ2603','Meera Iyer','+91 90040 77889','pending','cod',9800.00);

INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price)
SELECT o.id, p.id, p.name, 1, p.base_price
FROM public.orders o
JOIN public.products p ON (o.order_number,p.sku) IN (('RJ2601','RJ-NK-002'),('RJ2602','RJ-CH-006'),('RJ2603','RJ-KD-008'));
