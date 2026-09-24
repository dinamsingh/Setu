
import Navigation from './components/Navigation';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import TranslationGap from './components/TranslationGap';
import Trust from './components/Trust';
import InstitutionalMemory from './components/InstitutionalMemory';
import Demo from './components/Demo';
import LivePrototype from './components/LivePrototype';
import ProductScreenshot from './components/ProductScreenshot';
import Technology from './components/Technology';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Navigation />
      <main className="flex-grow">
        <Hero />
        <HowItWorks />
        <TranslationGap />
        <Trust />
        <InstitutionalMemory />
        <Demo />
        <LivePrototype />
        <ProductScreenshot />
        <Technology />
      </main>
      <Footer />
    </div>
  );
}

export default App;
