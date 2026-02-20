import InteractiveGlobe from './InteractiveGlobe';

export default function LandingPage({ onGetStarted }) {
  return (
    <main className="landing-page">
      <header className="top-nav">
        <div className="brand-mark">
          <div className="brand-dot" />
          <span>TravelMemory</span>
        </div>
        <nav>
          <button type="button">Home</button>
          <button type="button">Features</button>
          <button type="button">Scrapbook</button>
          <button type="button">Trip Stories</button>
        </nav>
        <button type="button" className="primary-pill" onClick={onGetStarted}>
          Get Started
        </button>
      </header>

      <section className="hero-panel">
        <InteractiveGlobe />
        <div className="hero-copy">
          <p className="eyebrow">MEMORIES THAT MOVE WITH YOU</p>
          <h1>Curate every journey into a story worth keeping.</h1>
          <p>
            Upload travel photos, places, and people. Let AI surface your most meaningful
            moments, map them beautifully, and build editable scrapbook logs.
          </p>
          <div className="hero-actions">
            <button type="button" className="cta-main" onClick={onGetStarted}>
              Start Your First Travel
            </button>
            <span>Travel -&gt; Trip -&gt; Story</span>
          </div>
          <div className="hero-stats">
            <div>
              <strong>Smart Curation</strong>
              <small>Reduces duplicate photos</small>
            </div>
            <div>
              <strong>Daily Scrapbook</strong>
              <small>Timestamped memory logs</small>
            </div>
            <div>
              <strong>Trip Stories</strong>
              <small>Text + video timeline outputs</small>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
