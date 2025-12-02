"""CAPTCHA solving module using open-source solutions."""

import asyncio
import base64
import os
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class CaptchaType(str, Enum):
    """Types of CAPTCHAs."""
    RECAPTCHA_V2 = "recaptcha_v2"
    RECAPTCHA_V3 = "recaptcha_v3"
    HCAPTCHA = "hcaptcha"
    IMAGE = "image"
    AUDIO = "audio"
    CLOUDFLARE = "cloudflare"


@dataclass
class CaptchaSolution:
    """Result of CAPTCHA solving attempt."""
    success: bool
    token: str | None = None
    error: str | None = None
    solver_used: str | None = None
    time_ms: float = 0


class CaptchaSolver(ABC):
    """Abstract base class for CAPTCHA solvers."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Solver name."""
        pass
    
    @abstractmethod
    async def solve(
        self,
        captcha_type: CaptchaType,
        **kwargs,
    ) -> CaptchaSolution:
        """Solve a CAPTCHA."""
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        """Check if solver is available."""
        pass


class AudioRecaptchaSolver(CaptchaSolver):
    """
    reCAPTCHA solver using audio challenge (GoogleRecaptchaBypass approach).
    
    Uses speech recognition to solve audio challenges.
    Requires: speech_recognition, pydub, ffmpeg
    """
    
    def __init__(self):
        self._sr = None
        self._pydub = None
    
    @property
    def name(self) -> str:
        return "audio_recaptcha"
    
    async def _lazy_import(self):
        """Lazy import heavy dependencies."""
        if self._sr is None:
            try:
                import speech_recognition as sr
                from pydub import AudioSegment
                self._sr = sr
                self._pydub = AudioSegment
            except ImportError as e:
                logger.error(
                    "Missing dependencies for audio solver",
                    error=str(e),
                    hint="pip install SpeechRecognition pydub",
                )
                raise
    
    async def solve(
        self,
        captcha_type: CaptchaType,
        audio_data: bytes | None = None,
        audio_url: str | None = None,
        **kwargs,
    ) -> CaptchaSolution:
        """
        Solve reCAPTCHA using audio challenge.
        
        Args:
            captcha_type: Must be RECAPTCHA_V2 or AUDIO
            audio_data: Raw audio bytes
            audio_url: URL to download audio from
        """
        import time
        start = time.time()
        
        if captcha_type not in (CaptchaType.RECAPTCHA_V2, CaptchaType.AUDIO):
            return CaptchaSolution(
                success=False,
                error=f"Unsupported captcha type: {captcha_type}",
                solver_used=self.name,
            )
        
        try:
            await self._lazy_import()
            
            # Get audio data
            if audio_url and not audio_data:
                import httpx
                async with httpx.AsyncClient() as client:
                    resp = await client.get(audio_url)
                    audio_data = resp.content
            
            if not audio_data:
                return CaptchaSolution(
                    success=False,
                    error="No audio data provided",
                    solver_used=self.name,
                )
            
            # Convert and recognize
            text = await self._recognize_audio(audio_data)
            
            if text:
                return CaptchaSolution(
                    success=True,
                    token=text,
                    solver_used=self.name,
                    time_ms=(time.time() - start) * 1000,
                )
            else:
                return CaptchaSolution(
                    success=False,
                    error="Could not recognize audio",
                    solver_used=self.name,
                    time_ms=(time.time() - start) * 1000,
                )
                
        except Exception as e:
            return CaptchaSolution(
                success=False,
                error=str(e),
                solver_used=self.name,
                time_ms=(time.time() - start) * 1000,
            )
    
    async def _recognize_audio(self, audio_data: bytes) -> str | None:
        """Convert audio to text using speech recognition."""
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(audio_data)
            mp3_path = f.name
        
        wav_path = mp3_path.replace(".mp3", ".wav")
        
        try:
            # Convert MP3 to WAV
            audio = self._pydub.from_mp3(mp3_path)
            audio.export(wav_path, format="wav")
            
            # Recognize speech
            recognizer = self._sr.Recognizer()
            with self._sr.AudioFile(wav_path) as source:
                audio_data = recognizer.record(source)
            
            # Try Google Speech Recognition (free)
            try:
                text = recognizer.recognize_google(audio_data)
                return text
            except self._sr.UnknownValueError:
                logger.warning("Google Speech Recognition could not understand audio")
                return None
                
        finally:
            # Cleanup
            for path in [mp3_path, wav_path]:
                if os.path.exists(path):
                    os.remove(path)
    
    async def health_check(self) -> bool:
        """Check if dependencies are available."""
        try:
            await self._lazy_import()
            return True
        except Exception:
            return False


class HCaptchaChallenger(CaptchaSolver):
    """
    hCaptcha solver using hcaptcha-challenger library.
    
    Uses AI models (YOLO, ResNet) to solve image challenges.
    Requires: hcaptcha-challenger
    """
    
    def __init__(self, model_dir: str | None = None):
        self.model_dir = model_dir
        self._challenger = None
    
    @property
    def name(self) -> str:
        return "hcaptcha_challenger"
    
    async def _lazy_import(self):
        """Lazy import hcaptcha-challenger."""
        if self._challenger is None:
            try:
                from hcaptcha_challenger import AgentChallenger
                self._challenger = AgentChallenger
            except ImportError as e:
                logger.error(
                    "Missing hcaptcha-challenger",
                    error=str(e),
                    hint="pip install hcaptcha-challenger",
                )
                raise
    
    async def solve(
        self,
        captcha_type: CaptchaType,
        page: Any = None,  # Playwright page
        **kwargs,
    ) -> CaptchaSolution:
        """
        Solve hCaptcha on a Playwright page.
        
        Args:
            captcha_type: Must be HCAPTCHA
            page: Playwright page object
        """
        import time
        start = time.time()
        
        if captcha_type != CaptchaType.HCAPTCHA:
            return CaptchaSolution(
                success=False,
                error=f"Unsupported captcha type: {captcha_type}",
                solver_used=self.name,
            )
        
        if not page:
            return CaptchaSolution(
                success=False,
                error="Playwright page required",
                solver_used=self.name,
            )
        
        try:
            await self._lazy_import()
            
            challenger = self._challenger(page)
            result = await challenger.solve()
            
            return CaptchaSolution(
                success=result,
                solver_used=self.name,
                time_ms=(time.time() - start) * 1000,
            )
            
        except Exception as e:
            return CaptchaSolution(
                success=False,
                error=str(e),
                solver_used=self.name,
                time_ms=(time.time() - start) * 1000,
            )
    
    async def health_check(self) -> bool:
        """Check if library is available."""
        try:
            await self._lazy_import()
            return True
        except Exception:
            return False


class CloudflareBypasser(CaptchaSolver):
    """
    Cloudflare bypass using cloudscraper library.
    
    Handles Cloudflare's JavaScript challenges and Turnstile.
    Requires: cloudscraper
    """
    
    def __init__(self):
        self._scraper = None
    
    @property
    def name(self) -> str:
        return "cloudscraper"
    
    def _get_scraper(self):
        """Get or create cloudscraper instance."""
        if self._scraper is None:
            try:
                import cloudscraper
                self._scraper = cloudscraper.create_scraper(
                    browser={
                        "browser": "chrome",
                        "platform": "windows",
                        "mobile": False,
                    },
                    delay=10,
                )
            except ImportError as e:
                logger.error(
                    "Missing cloudscraper",
                    error=str(e),
                    hint="pip install cloudscraper",
                )
                raise
        return self._scraper
    
    async def solve(
        self,
        captcha_type: CaptchaType,
        url: str | None = None,
        **kwargs,
    ) -> CaptchaSolution:
        """
        Bypass Cloudflare protection.
        
        Args:
            captcha_type: Must be CLOUDFLARE
            url: URL to access through Cloudflare
        """
        import time
        start = time.time()
        
        if captcha_type != CaptchaType.CLOUDFLARE:
            return CaptchaSolution(
                success=False,
                error=f"Unsupported captcha type: {captcha_type}",
                solver_used=self.name,
            )
        
        if not url:
            return CaptchaSolution(
                success=False,
                error="URL required",
                solver_used=self.name,
            )
        
        try:
            scraper = self._get_scraper()
            
            # Execute in thread pool since cloudscraper is synchronous
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: scraper.get(url),
            )
            
            if response.status_code == 200:
                return CaptchaSolution(
                    success=True,
                    token=response.text[:100],  # First 100 chars as verification
                    solver_used=self.name,
                    time_ms=(time.time() - start) * 1000,
                )
            else:
                return CaptchaSolution(
                    success=False,
                    error=f"HTTP {response.status_code}",
                    solver_used=self.name,
                    time_ms=(time.time() - start) * 1000,
                )
                
        except Exception as e:
            return CaptchaSolution(
                success=False,
                error=str(e),
                solver_used=self.name,
                time_ms=(time.time() - start) * 1000,
            )
    
    async def get_session_cookies(self, url: str) -> dict[str, str]:
        """Get Cloudflare bypass cookies for a URL."""
        try:
            scraper = self._get_scraper()
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: scraper.get(url))
            return dict(scraper.cookies)
        except Exception as e:
            logger.error("Failed to get Cloudflare cookies", url=url, error=str(e))
            return {}
    
    async def health_check(self) -> bool:
        """Check if cloudscraper is available."""
        try:
            self._get_scraper()
            return True
        except Exception:
            return False


class CaptchaSolverOrchestrator:
    """
    Orchestrates multiple CAPTCHA solvers.
    
    Tries different solvers based on CAPTCHA type and availability.
    """
    
    def __init__(self):
        self.solvers: dict[CaptchaType, list[CaptchaSolver]] = {
            CaptchaType.RECAPTCHA_V2: [AudioRecaptchaSolver()],
            CaptchaType.AUDIO: [AudioRecaptchaSolver()],
            CaptchaType.HCAPTCHA: [HCaptchaChallenger()],
            CaptchaType.CLOUDFLARE: [CloudflareBypasser()],
        }
    
    def add_solver(self, captcha_type: CaptchaType, solver: CaptchaSolver):
        """Add a solver for a captcha type."""
        if captcha_type not in self.solvers:
            self.solvers[captcha_type] = []
        self.solvers[captcha_type].append(solver)
    
    async def solve(
        self,
        captcha_type: CaptchaType,
        **kwargs,
    ) -> CaptchaSolution:
        """
        Try to solve CAPTCHA using available solvers.
        
        Args:
            captcha_type: Type of CAPTCHA
            **kwargs: Solver-specific arguments
            
        Returns:
            CaptchaSolution with result
        """
        solvers = self.solvers.get(captcha_type, [])
        
        if not solvers:
            return CaptchaSolution(
                success=False,
                error=f"No solver available for {captcha_type}",
            )
        
        errors = []
        for solver in solvers:
            try:
                # Check health first
                if not await solver.health_check():
                    errors.append(f"{solver.name}: not available")
                    continue
                
                result = await solver.solve(captcha_type, **kwargs)
                
                if result.success:
                    logger.info(
                        "CAPTCHA solved",
                        captcha_type=captcha_type.value,
                        solver=solver.name,
                        time_ms=result.time_ms,
                    )
                    return result
                else:
                    errors.append(f"{solver.name}: {result.error}")
                    
            except Exception as e:
                errors.append(f"{solver.name}: {str(e)}")
        
        return CaptchaSolution(
            success=False,
            error=f"All solvers failed: {'; '.join(errors)}",
        )
    
    async def get_available_solvers(self) -> dict[str, list[str]]:
        """Get list of available solvers by captcha type."""
        available = {}
        for captcha_type, solvers in self.solvers.items():
            available[captcha_type.value] = []
            for solver in solvers:
                if await solver.health_check():
                    available[captcha_type.value].append(solver.name)
        return available
